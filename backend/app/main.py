from fastapi import FastAPI, UploadFile, File, Form, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from pydantic import BaseModel
from typing import Optional
import numpy as np
from PIL import Image
import io
import json
import os
import uuid
import base64
import traceback
from dotenv import load_dotenv

# Load environment variables from .env file (override=True to ensure .env takes precedence)
load_dotenv(override=True)

from models.sam_model import get_sam_instance
from models.coordinate_converter import CoordinateConverter
from app.realtime import router as realtime_router

# Import SAM3 implementations (try Transformers first, then HF API)
SAM3_TRANSFORMERS_AVAILABLE = False
SAM3_HF_AVAILABLE = False
SAM3_LOCAL_AVAILABLE = False

# Priority 1: Transformers (local, best performance)
try:
    from models.sam3_transformers import get_sam3_transformers_instance
    SAM3_TRANSFORMERS_AVAILABLE = True
    print("✓ SAM3 Transformers available (preferred method)")
except ImportError as e:
    print(f"SAM3 Transformers not available: {e}")

# Priority 2: Hugging Face API (requires network)
try:
    from models.sam3_hf_api import get_sam3_hf_instance
    SAM3_HF_AVAILABLE = True
    print("✓ SAM3 HF API client available (fallback method)")
except ImportError:
    print("SAM3 HF API client not available")

# Priority 3: Local SAM3 model (requires complex dependencies)
try:
    from models.sam3_model import get_sam3_instance, SAMGEO_AVAILABLE
    SAM3_LOCAL_AVAILABLE = SAMGEO_AVAILABLE
except ImportError:
    SAM3_LOCAL_AVAILABLE = False

# SAM3 is available if any method is available
SAM3_AVAILABLE = SAM3_TRANSFORMERS_AVAILABLE or SAM3_HF_AVAILABLE or SAM3_LOCAL_AVAILABLE
if not SAM3_AVAILABLE:
    print("⚠ SAM3 not available, using SAM1 only")

app = FastAPI(title="GuZhu AI Service")


# 全局异常处理器 - 确保所有未捕获的异常都返回 JSON 格式
@app.exception_handler(Exception)
async def global_exception_handler(request: Request, exc: Exception):
    traceback.print_exc()
    return JSONResponse(
        status_code=500,
        content={"detail": f"Internal server error: {str(exc)}"},
    )


# CORS 配置 - 支持环境变量，默认允许本地开发端口
CORS_ORIGINS = os.environ.get(
    "CORS_ORIGINS",
    "http://localhost:3000,http://localhost:5173,http://localhost"
).split(",")

app.add_middleware(
    CORSMiddleware,
    allow_origins=CORS_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Register Realtime API router for voice control
app.include_router(realtime_router)


class Point(BaseModel):
    x: float
    y: float
    label: int

class ImageBounds(BaseModel):
    west: float
    south: float
    east: float
    north: float

# Global SAM instances (lazy loaded)
sam_segmenter = None
sam3_segmenter = None  # For SAM3 features

@app.get("/")
async def root():
    return {"message": "GuZhu AI Service is running"}

@app.post("/api/segment")
async def segment_image(
    file: UploadFile = File(...),
    points: str = Form(...),
    bounds: Optional[str] = Form(None),
    bearing: float = Form(0.0),
    min_confidence: float = Form(0.0),
    min_size: Optional[int] = Form(None),
    max_size: Optional[int] = Form(None)
):
    """
    Segment image using SAM model based on point prompts

    Args:
        file: Image file
        points: JSON string of point coordinates and labels
        bounds: Optional JSON string of image geographic bounds
        bearing: Map rotation angle in degrees (0 = north up, positive = clockwise), default 0.0
        min_confidence: Minimum confidence threshold (0-1), default 0.0
        min_size: Minimum object size in pixels (area), optional
        max_size: Maximum object size in pixels (area), optional

    Returns:
        GeoJSON FeatureCollection of segmented polygons
    """
    global sam_segmenter

    try:
        # Parse points
        points_data = json.loads(points)
        point_coords = [(p['x'], p['y']) for p in points_data]
        point_labels = [p['label'] for p in points_data]

        # Read and process image
        contents = await file.read()
        image = Image.open(io.BytesIO(contents))
        image_np = np.array(image.convert('RGB'))

        # Initialize SAM if not already done
        if sam_segmenter is None:
            try:
                sam_segmenter = get_sam_instance()
            except FileNotFoundError as e:
                raise HTTPException(
                    status_code=500,
                    detail=str(e)
                )

        # Set image and perform segmentation
        sam_segmenter.set_image(image_np)
        print(f"Image shape: {image_np.shape}")
        print(f"Point coords: {point_coords}")
        print(f"Point labels: {point_labels}")

        mask = sam_segmenter.segment_from_points(point_coords, point_labels)
        print(f"Mask shape: {mask.shape}")
        print(f"Mask sum (pixels): {mask.sum()}")
        print(f"Mask unique values: {np.unique(mask)}")

        # Generate thumbnail from mask
        thumbnail_b64 = None
        bbox_list = None
        mask_bool = mask.astype(bool)
        y_indices, x_indices = np.where(mask_bool)

        if len(x_indices) > 0:
            x1, y1 = int(x_indices.min()), int(y_indices.min())
            x2, y2 = int(x_indices.max()), int(y_indices.max())
            bbox_list = [x1, y1, x2, y2]

            padding = 5
            x1 = max(0, x1 - padding)
            y1 = max(0, y1 - padding)
            x2 = min(image.width, x2 + padding)
            y2 = min(image.height, y2 + padding)

            try:
                thumbnail_img = image.crop((x1, y1, x2, y2))
                thumbnail_img.thumbnail((100, 100), Image.Resampling.LANCZOS)

                buffer = io.BytesIO()
                thumbnail_img.save(buffer, format='PNG')
                thumbnail_b64 = base64.b64encode(buffer.getvalue()).decode('utf-8')
            except Exception as e:
                print(f"Warning: Failed to generate thumbnail: {e}")

        # Convert mask to polygons
        polygons = sam_segmenter.mask_to_polygon(mask)
        print(f"Number of polygons: {len(polygons)}")
        if polygons:
            print(f"First polygon points: {len(polygons[0])}")

        # Calculate pixel area for size filtering
        pixel_area = int(np.sum(mask))

        # Apply size filters
        if min_size is not None and pixel_area < min_size:
            # Return empty result if size too small
            return {
                "success": True,
                "geojson": {
                    "type": "FeatureCollection",
                    "features": []
                }
            }
        if max_size is not None and pixel_area > max_size:
            # Return empty result if size too large
            return {
                "success": True,
                "geojson": {
                    "type": "FeatureCollection",
                    "features": []
                }
            }

        # Apply confidence filter (for point mode, confidence is always 1.0, so this mainly serves consistency)
        confidence = 1.0
        if confidence < min_confidence:
            return {
                "success": True,
                "geojson": {
                    "type": "FeatureCollection",
                    "features": []
                }
            }

        # Convert to GeoJSON
        features = []
        for i, polygon in enumerate(polygons):
            if bounds:
                bounds_data = json.loads(bounds)
                converter = CoordinateConverter(
                    bounds_data,
                    (image.width, image.height)
                )
                geo_polygon = [converter.pixel_to_geo(x, y) for x, y in polygon]
                if geo_polygon[0] != geo_polygon[-1]:
                    geo_polygon.append(geo_polygon[0])
                coords = [geo_polygon]
            else:
                coords = [polygon]

            features.append({
                "type": "Feature",
                "id": str(uuid.uuid4()),
                "geometry": {
                    "type": "Polygon",
                    "coordinates": coords
                },
                "properties": {
                    "class": "points",
                    "segmentation_mode": "points",
                    "confidence": confidence,
                    "pixel_area": pixel_area,
                    "bbox": bbox_list,
                    "thumbnail": thumbnail_b64
                }
            })

        geojson = {
            "type": "FeatureCollection",
            "features": features
        }

        return {
            "success": True,
            "geojson": geojson
        }

    except json.JSONDecodeError:
        raise HTTPException(status_code=400, detail="Invalid JSON in points or bounds")
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/health")
async def health_check():
    """Health check endpoint"""
    return {
        "status": "healthy",
        "sam_loaded": sam_segmenter is not None,
        "sam3_available": SAM3_AVAILABLE
    }

@app.get("/api/model-info")
async def model_info():
    """Get information about loaded models"""
    return {
        "sam_loaded": sam_segmenter is not None,
        "device": sam_segmenter.device if sam_segmenter else None,
        "sam3_available": SAM3_AVAILABLE,
        "sam3_loaded": sam3_segmenter is not None
    }

@app.post("/api/segment-text")
async def segment_image_with_text(
    file: UploadFile = File(...),
    text_prompt: str = Form(...),
    bounds: Optional[str] = Form(None),
    bearing: float = Form(0.0)
):
    """
    Segment image using SAM3 with text prompt.

    Args:
        file: Image file
        text_prompt: Text description of objects to segment (e.g., "buildings", "trees", "roads")
        bounds: Optional JSON string of image geographic bounds
        bearing: Map rotation angle in degrees (0 = north up, positive = clockwise), default 0.0

    Returns:
        GeoJSON FeatureCollection of segmented polygons with class labels
    """
    global sam3_segmenter

    if not SAM3_AVAILABLE:
        raise HTTPException(
            status_code=501,
            detail="SAM3 not available. Install with: pip install segment-geospatial[samgeo3]"
        )

    try:
        # Read and process image
        contents = await file.read()
        image = Image.open(io.BytesIO(contents))
        image_np = np.array(image.convert('RGB'))

        # Initialize SAM3 if not already done
        if sam3_segmenter is None:
            try:
                # Priority 1: Transformers (local, fastest, best quality)
                if SAM3_TRANSFORMERS_AVAILABLE:
                    sam3_segmenter = get_sam3_transformers_instance()
                    print("Using SAM3 via Transformers (local)")
                # Priority 2: HF API (requires network)
                elif SAM3_HF_AVAILABLE:
                    sam3_segmenter = get_sam3_hf_instance()
                    print("Using SAM3 via Hugging Face API")
                # Priority 3: Local samgeo model
                elif SAM3_LOCAL_AVAILABLE:
                    from models.sam3_model import get_sam3_instance as get_local_sam3
                    sam3_segmenter = get_local_sam3()
                    print("Using local SAM3 model")
                else:
                    raise Exception("No SAM3 backend available")
            except Exception as e:
                raise HTTPException(
                    status_code=500,
                    detail=f"Failed to load SAM3 model: {str(e)}"
                )

        print(f"Image shape: {image_np.shape}")
        print(f"Text prompt: '{text_prompt}'")

        # Set image
        sam3_segmenter.set_image(image_np)

        # Perform text-based segmentation
        try:
            results = sam3_segmenter.segment_from_text(text_prompt)

            if not results:
                print("Warning: Text segmentation returned no results (no objects detected or all filtered out)")
                # Return empty GeoJSON instead of error - this is a valid result
                return {
                    "success": True,
                    "geojson": {
                        "type": "FeatureCollection",
                        "features": []
                    },
                    "text_prompt": text_prompt
                }

            # Convert results to GeoJSON
            features = []
            for i, result in enumerate(results):
                mask = result.get('mask')
                bbox = result.get('box')  # SAM3 may return bounding box

                if mask is not None:
                    # Generate thumbnail from mask region
                    thumbnail_b64 = None
                    bbox_list = None

                    if bbox is not None and len(bbox) == 4:
                        # Use provided bbox
                        x1, y1, x2, y2 = map(int, bbox)
                        bbox_list = [x1, y1, x2, y2]
                    else:
                        # Calculate bbox from mask
                        mask_bool = mask.astype(bool)
                        y_indices, x_indices = np.where(mask_bool)
                        if len(x_indices) > 0:
                            x1, y1 = int(x_indices.min()), int(y_indices.min())
                            x2, y2 = int(x_indices.max()), int(y_indices.max())
                            bbox_list = [x1, y1, x2, y2]

                    # Generate thumbnail if we have bbox
                    if bbox_list:
                        x1, y1, x2, y2 = bbox_list
                        # Add padding and clamp to image bounds
                        padding = 5
                        x1 = max(0, x1 - padding)
                        y1 = max(0, y1 - padding)
                        x2 = min(image.width, x2 + padding)
                        y2 = min(image.height, y2 + padding)

                        try:
                            thumbnail_img = image.crop((x1, y1, x2, y2))
                            thumbnail_img.thumbnail((100, 100), Image.Resampling.LANCZOS)

                            buffer = io.BytesIO()
                            thumbnail_img.save(buffer, format='PNG')
                            thumbnail_b64 = base64.b64encode(buffer.getvalue()).decode('utf-8')
                        except Exception as e:
                            print(f"Warning: Failed to generate thumbnail: {e}")
                            thumbnail_b64 = None

                    polygons = sam3_segmenter.mask_to_polygon(mask)

                    for j, polygon in enumerate(polygons):
                        # Calculate pixel area
                        pixel_area = int(np.sum(mask))
                        confidence = result.get('confidence', 1.0)

                        if bounds:
                            bounds_data = json.loads(bounds)
                            converter = CoordinateConverter(
                                bounds_data,
                                (image.width, image.height)
                            )
                            geo_polygon = [converter.pixel_to_geo(x, y) for x, y in polygon]
                            if geo_polygon[0] != geo_polygon[-1]:
                                geo_polygon.append(geo_polygon[0])
                            coords = [geo_polygon]
                        else:
                            coords = [polygon]

                        features.append({
                            "type": "Feature",
                            "id": str(uuid.uuid4()),  # Unique ID
                            "geometry": {
                                "type": "Polygon",
                                "coordinates": coords
                            },
                            "properties": {
                                "class": text_prompt,
                                "segmentation_mode": "text",
                                "confidence": confidence,
                                "pixel_area": pixel_area,
                                "bbox": bbox_list,
                                "thumbnail": thumbnail_b64
                            }
                        })

            geojson = {
                "type": "FeatureCollection",
                "features": features
            }

            print(f"Generated {len(features)} features for class '{text_prompt}'")

            return {
                "success": True,
                "geojson": geojson,
                "text_prompt": text_prompt
            }

        except NotImplementedError as e:
            raise HTTPException(
                status_code=501,
                detail=str(e)
            )

    except json.JSONDecodeError:
        raise HTTPException(status_code=400, detail="Invalid JSON in bounds")
    except Exception as e:
        import traceback
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/api/segment-auto")
async def segment_image_automatic(
    file: UploadFile = File(...),
    bounds: Optional[str] = Form(None),
    bearing: float = Form(0.0),
    min_confidence: float = Form(0.8),
    min_size: Optional[int] = Form(None),
    max_size: Optional[int] = Form(None)
):
    """
    Automatically segment all objects in the image (no prompts needed).

    Args:
        file: Image file
        bounds: Optional JSON string of image geographic bounds
        bearing: Map rotation angle in degrees (0 = north up, positive = clockwise), default 0.0
        min_confidence: Minimum confidence threshold (0-1), default 0.8
        min_size: Minimum object size in pixels (area), optional
        max_size: Maximum object size in pixels (area), optional

    Returns:
        GeoJSON FeatureCollection of all detected objects
    """
    global sam3_segmenter

    if not SAM3_AVAILABLE:
        raise HTTPException(
            status_code=501,
            detail="SAM3 not available. Install with: pip install segment-geospatial[samgeo3]"
        )

    try:
        # Read and process image
        contents = await file.read()
        image = Image.open(io.BytesIO(contents))
        image_np = np.array(image.convert('RGB'))

        # Initialize SAM3 if not already done
        if sam3_segmenter is None:
            try:
                # Priority 1: Transformers (local, fastest, best quality)
                if SAM3_TRANSFORMERS_AVAILABLE:
                    sam3_segmenter = get_sam3_transformers_instance()
                    print("Using SAM3 via Transformers (local)")
                # Priority 2: HF API (requires network)
                elif SAM3_HF_AVAILABLE:
                    sam3_segmenter = get_sam3_hf_instance()
                    print("Using SAM3 via Hugging Face API")
                # Priority 3: Local samgeo model
                elif SAM3_LOCAL_AVAILABLE:
                    from models.sam3_model import get_sam3_instance as get_local_sam3
                    sam3_segmenter = get_local_sam3()
                    print("Using local SAM3 model")
                else:
                    raise Exception("No SAM3 backend available")
            except Exception as e:
                raise HTTPException(
                    status_code=500,
                    detail=f"Failed to load SAM3 model: {str(e)}"
                )

        print(f"Image shape: {image_np.shape}")
        print("Performing automatic segmentation...")

        # Set image
        sam3_segmenter.set_image(image_np)

        try:
            results = sam3_segmenter.segment_automatic()

            if not results:
                print("Warning: Automatic segmentation returned no results (no objects detected or all filtered out)")
                # Return empty GeoJSON instead of error - this is a valid result
                return {
                    "success": True,
                    "geojson": {
                        "type": "FeatureCollection",
                        "features": []
                    }
                }

            # Convert results to GeoJSON
            features = []
            for i, result in enumerate(results):
                mask = result.get('mask')
                bbox = result.get('box')

                if mask is not None:
                    # Generate thumbnail from mask region
                    thumbnail_b64 = None
                    bbox_list = None

                    if bbox is not None and len(bbox) == 4:
                        x1, y1, x2, y2 = map(int, bbox)
                        bbox_list = [x1, y1, x2, y2]
                    else:
                        # Calculate bbox from mask
                        mask_bool = mask.astype(bool)
                        y_indices, x_indices = np.where(mask_bool)
                        if len(x_indices) > 0:
                            x1, y1 = int(x_indices.min()), int(y_indices.min())
                            x2, y2 = int(x_indices.max()), int(y_indices.max())
                            bbox_list = [x1, y1, x2, y2]

                    # Generate thumbnail if we have bbox
                    if bbox_list:
                        x1, y1, x2, y2 = bbox_list
                        padding = 5
                        x1 = max(0, x1 - padding)
                        y1 = max(0, y1 - padding)
                        x2 = min(image.width, x2 + padding)
                        y2 = min(image.height, y2 + padding)

                        try:
                            thumbnail_img = image.crop((x1, y1, x2, y2))
                            thumbnail_img.thumbnail((100, 100), Image.Resampling.LANCZOS)

                            buffer = io.BytesIO()
                            thumbnail_img.save(buffer, format='PNG')
                            thumbnail_b64 = base64.b64encode(buffer.getvalue()).decode('utf-8')
                        except Exception as e:
                            print(f"Warning: Failed to generate thumbnail: {e}")
                            thumbnail_b64 = None

                    polygons = sam3_segmenter.mask_to_polygon(mask)

                    for j, polygon in enumerate(polygons):
                        # Calculate pixel area
                        pixel_area = int(np.sum(mask))
                        confidence = result.get('confidence', 1.0)

                        if bounds:
                            bounds_data = json.loads(bounds)
                            converter = CoordinateConverter(
                                bounds_data,
                                (image.width, image.height)
                            )
                            geo_polygon = [converter.pixel_to_geo(x, y) for x, y in polygon]
                            if geo_polygon[0] != geo_polygon[-1]:
                                geo_polygon.append(geo_polygon[0])
                            coords = [geo_polygon]
                        else:
                            coords = [polygon]

                        features.append({
                            "type": "Feature",
                            "id": str(uuid.uuid4()),
                            "geometry": {
                                "type": "Polygon",
                                "coordinates": coords
                            },
                            "properties": {
                                "class": "auto",
                                "segmentation_mode": "automatic",
                                "confidence": confidence,
                                "pixel_area": pixel_area,
                                "bbox": bbox_list,
                                "thumbnail": thumbnail_b64
                            }
                        })

            geojson = {
                "type": "FeatureCollection",
                "features": features
            }

            print(f"Generated {len(features)} features via automatic segmentation")

            return {
                "success": True,
                "geojson": geojson
            }

        except NotImplementedError as e:
            raise HTTPException(
                status_code=501,
                detail=str(e)
            )

    except json.JSONDecodeError:
        raise HTTPException(status_code=400, detail="Invalid JSON in bounds")
    except Exception as e:
        import traceback
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/api/segment-single")
async def segment_single_object(
    file: UploadFile = File(...),
    prompt_type: str = Form(...),
    prompt_data: str = Form(...),
    bounds: Optional[str] = Form(None),
    bearing: float = Form(0.0)
):
    """
    Segment a single object using point prompt for Add Object feature.

    Args:
        file: Image file
        prompt_type: Prompt type ("point")
        prompt_data: JSON string with pixel coordinates
        bounds: Optional JSON string of image geographic bounds
        bearing: Map rotation angle in degrees (0 = north up, positive = clockwise), default 0.0

    Returns:
        Single GeoJSON Feature with unique ID and thumbnail
    """
    global sam_segmenter

    if prompt_type != "point":
        raise HTTPException(
            status_code=400,
            detail=f"Unsupported prompt_type: {prompt_type}. Only 'point' is supported."
        )

    try:
        # Parse prompt data
        points_data = json.loads(prompt_data)
        if not isinstance(points_data, list) or len(points_data) == 0:
            raise HTTPException(
                status_code=400,
                detail="prompt_data must be a non-empty array of points"
            )

        # Read and process image
        contents = await file.read()
        image = Image.open(io.BytesIO(contents))
        image_np = np.array(image.convert('RGB'))

        print("========== 后端接收到的分割请求 ==========")
        print(f"1. 图像尺寸: {image.width} x {image.height}")
        print(f"2. 图像格式: {image.format}, 模式: {image.mode}")
        print(f"3. NumPy数组形状: {image_np.shape}")

        # Parse bounds if provided
        bounds_data = None
        if bounds:
            bounds_data = json.loads(bounds)
            print(f"4. 接收到的 bounds: {bounds_data}")
        else:
            print("4. 未提供 bounds")

        # Initialize SAM if not already done
        if sam_segmenter is None:
            try:
                sam_segmenter = get_sam_instance()
            except FileNotFoundError as e:
                raise HTTPException(
                    status_code=500,
                    detail=str(e)
                )

        sam_segmenter.set_image(image_np)

        # Extract pixel coordinates from prompt_data
        point_coords = [(p['x'], p['y']) for p in points_data]
        point_labels = [p.get('label', 1) for p in points_data]

        print(f"5. 接收到的点坐标 (像素): {point_coords}")
        print(f"6. 点标签: {point_labels}")

        # Perform segmentation
        mask = sam_segmenter.segment_from_points(point_coords, point_labels)

        # Generate thumbnail from mask
        thumbnail_b64 = None
        bbox_list = None
        mask_bool = mask.astype(bool)
        y_indices, x_indices = np.where(mask_bool)

        if len(x_indices) > 0:
            x1, y1 = int(x_indices.min()), int(y_indices.min())
            x2, y2 = int(x_indices.max()), int(y_indices.max())
            bbox_list = [x1, y1, x2, y2]

            padding = 5
            x1 = max(0, x1 - padding)
            y1 = max(0, y1 - padding)
            x2 = min(image.width, x2 + padding)
            y2 = min(image.height, y2 + padding)

            try:
                thumbnail_img = image.crop((x1, y1, x2, y2))
                thumbnail_img.thumbnail((100, 100), Image.Resampling.LANCZOS)

                buffer = io.BytesIO()
                thumbnail_img.save(buffer, format='PNG')
                thumbnail_b64 = base64.b64encode(buffer.getvalue()).decode('utf-8')
            except Exception as e:
                print(f"Warning: Failed to generate thumbnail: {e}")

        # Convert mask to polygons
        polygons = sam_segmenter.mask_to_polygon(mask)

        print(f"7. 检测到 {len(polygons)} 个多边形")

        if not polygons:
            raise HTTPException(status_code=404, detail="No polygon detected from the given points")

        # Only return the first (largest) polygon
        polygon = polygons[0]
        print(f"8. 选择最大多边形，包含 {len(polygon)} 个点")
        print(f"9. 多边形像素坐标示例 (前3个点): {polygon[:3]}")

        # Convert to geographic coordinates if bounds provided
        if bounds_data:
            print(f"10. 开始坐标转换:")
            print(f"    - 图像尺寸: {image.width} x {image.height}")
            print(f"    - Bounds: {bounds_data}")
            converter = CoordinateConverter(bounds_data, (image.width, image.height))
            geo_polygon = [converter.pixel_to_geo(x, y) for x, y in polygon]
            print(f"11. 地理坐标示例 (前3个点): {geo_polygon[:3]}")
            if geo_polygon[0] != geo_polygon[-1]:
                geo_polygon.append(geo_polygon[0])
            coords = [geo_polygon]
        else:
            print("10. 未进行坐标转换 (无bounds)")
            coords = [polygon]

        print("===========================================")

        # Build Feature
        feature = {
            "type": "Feature",
            "id": str(uuid.uuid4()),
            "geometry": {
                "type": "Polygon",
                "coordinates": coords
            },
            "properties": {
                "class": "manual",
                "confidence": 1.0,
                "bbox": bbox_list,
                "thumbnail": thumbnail_b64,
                "segmentation_mode": "manual"
            }
        }

        print(f"Successfully segmented single object")

        return {
            "success": True,
            "feature": feature
        }

    except json.JSONDecodeError as e:
        raise HTTPException(status_code=400, detail=f"Invalid JSON: {str(e)}")
    except Exception as e:
        import traceback
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/api/segment-batch")
async def segment_batch_objects(
    file: UploadFile = File(...),
    points_list: str = Form(...),
    bounds: Optional[str] = Form(None),
    bearing: float = Form(0.0)
):
    """
    Batch segment multiple objects using point prompts.

    Args:
        file: Image file
        points_list: JSON string with array of point arrays
        bounds: Optional JSON string of image geographic bounds
        bearing: Map rotation angle in degrees (0 = north up, positive = clockwise), default 0.0

    Returns:
        Array of GeoJSON Features
    """
    global sam_segmenter

    try:
        # Parse points list
        points_data_list = json.loads(points_list)
        if not isinstance(points_data_list, list) or len(points_data_list) == 0:
            raise HTTPException(
                status_code=400,
                detail="points_list must be a non-empty array of point arrays"
            )

        # Read and process image
        contents = await file.read()
        image = Image.open(io.BytesIO(contents))
        image_np = np.array(image.convert('RGB'))

        # Initialize SAM if not already done
        if sam_segmenter is None:
            try:
                sam_segmenter = get_sam_instance()
            except FileNotFoundError as e:
                raise HTTPException(
                    status_code=500,
                    detail=str(e)
                )

        # Set image once for all objects
        sam_segmenter.set_image(image_np)
        print(f"Batch segmentation: processing {len(points_data_list)} objects")

        # Process each set of points
        features = []
        successful = 0

        for idx, points_data in enumerate(points_data_list):
            try:
                # Extract pixel coordinates
                point_coords = [(p['x'], p['y']) for p in points_data]
                point_labels = [p.get('label', 1) for p in points_data]

                print(f"  Object {idx+1}: {len(point_coords)} points at {point_coords}")

                # Perform segmentation
                mask = sam_segmenter.segment_from_points(point_coords, point_labels)

                # Generate thumbnail
                thumbnail_b64 = None
                bbox_list = None
                mask_bool = mask.astype(bool)
                y_indices, x_indices = np.where(mask_bool)

                if len(x_indices) > 0:
                    x1, y1 = int(x_indices.min()), int(y_indices.min())
                    x2, y2 = int(x_indices.max()), int(y_indices.max())
                    bbox_list = [x1, y1, x2, y2]

                    padding = 5
                    x1 = max(0, x1 - padding)
                    y1 = max(0, y1 - padding)
                    x2 = min(image.width, x2 + padding)
                    y2 = min(image.height, y2 + padding)

                    try:
                        thumbnail_img = image.crop((x1, y1, x2, y2))
                        thumbnail_img.thumbnail((100, 100), Image.Resampling.LANCZOS)

                        buffer = io.BytesIO()
                        thumbnail_img.save(buffer, format='PNG')
                        thumbnail_b64 = base64.b64encode(buffer.getvalue()).decode('utf-8')
                    except Exception as e:
                        print(f"Warning: Failed to generate thumbnail for object {idx+1}: {e}")

                # Convert mask to polygons
                polygons = sam_segmenter.mask_to_polygon(mask)

                if not polygons:
                    print(f"Warning: No polygon detected for object {idx+1}")
                    continue

                # Only use the first (largest) polygon
                polygon = polygons[0]

                # Convert to geographic coordinates if bounds provided
                if bounds:
                    bounds_data = json.loads(bounds)
                    image_width, image_height = image.size
                    converter = CoordinateConverter(
                        bounds_data,
                        (image_width, image_height)
                    )
                    geo_polygon = [converter.pixel_to_geo(x, y) for x, y in polygon]
                    if geo_polygon and geo_polygon[0] != geo_polygon[-1]:
                        geo_polygon.append(geo_polygon[0])
                else:
                    geo_polygon = polygon

                # Create GeoJSON feature
                feature_id = str(uuid.uuid4())
                feature = {
                    "type": "Feature",
                    "id": feature_id,
                    "geometry": {
                        "type": "Polygon",
                        "coordinates": [geo_polygon]
                    },
                    "properties": {
                        "class": "manual",
                        "confidence": 1.0,
                        "segmentation_mode": "batch",
                        "bbox": bbox_list,
                        "thumbnail": f"data:image/png;base64,{thumbnail_b64}" if thumbnail_b64 else None
                    }
                }

                features.append(feature)
                successful += 1
                print(f"  Object {idx+1}: ✓ Successfully segmented")

            except Exception as e:
                print(f"  Object {idx+1}: ✗ Failed - {str(e)}")
                continue

        print(f"Batch segmentation complete: {successful}/{len(points_data_list)} objects extracted")

        return {
            "success": True,
            "features": features,
            "total": len(points_data_list),
            "successful": successful
        }

    except json.JSONDecodeError as e:
        raise HTTPException(status_code=400, detail=f"Invalid JSON: {str(e)}")
    except Exception as e:
        import traceback
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/api/export-shapefile")
async def export_shapefile(geojson_data: dict):
    """
    Export GeoJSON to Shapefile ZIP archive.

    Args:
        geojson_data: GeoJSON FeatureCollection

    Returns:
        StreamingResponse with ZIP file containing shapefile components
    """
    import geopandas as gpd
    import tempfile
    import shutil
    from fastapi.responses import StreamingResponse

    try:
        # Validate GeoJSON structure
        if geojson_data.get('type') != 'FeatureCollection':
            raise HTTPException(
                status_code=400,
                detail="Invalid GeoJSON: must be a FeatureCollection"
            )

        features = geojson_data.get('features', [])
        if not features:
            raise HTTPException(
                status_code=400,
                detail="No features to export"
            )

        # Convert GeoJSON to GeoDataFrame
        gdf = gpd.GeoDataFrame.from_features(features)

        # Set CRS to WGS84 (EPSG:4326) for geographic coordinates
        gdf.set_crs(epsg=4326, inplace=True)

        # Create temporary directory for shapefile components
        temp_dir = tempfile.mkdtemp()
        shapefile_dir = os.path.join(temp_dir, "shapefiles")
        os.makedirs(shapefile_dir, exist_ok=True)
        shapefile_path = os.path.join(shapefile_dir, "segmentation.shp")

        try:
            # Write to shapefile (creates .shp, .shx, .dbf, .prj, etc.)
            gdf.to_file(shapefile_path, driver='ESRI Shapefile', encoding='utf-8')

            # Create ZIP archive in a separate location (to avoid including the zip itself)
            zip_output_path = os.path.join(temp_dir, "segmentation_shapefile")
            shutil.make_archive(
                zip_output_path,
                'zip',
                shapefile_dir  # Only zip the shapefile directory
            )

            # Read ZIP file into memory
            zip_path = zip_output_path + '.zip'
            with open(zip_path, 'rb') as f:
                zip_data = f.read()

            # Clean up temp directory
            shutil.rmtree(temp_dir)

            # Return ZIP file as streaming response
            return StreamingResponse(
                io.BytesIO(zip_data),
                media_type='application/zip',
                headers={
                    'Content-Disposition': 'attachment; filename="segmentation_shapefile.zip"'
                }
            )

        except Exception as e:
            # Clean up on error
            if os.path.exists(temp_dir):
                shutil.rmtree(temp_dir)
            raise e

    except HTTPException:
        raise
    except Exception as e:
        import traceback
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=f"Export failed: {str(e)}")


@app.post("/api/upload-tiff")
async def upload_tiff(file: UploadFile = File(...)):
    """
    Upload a GeoTIFF file and return PNG image with geographic bounds.

    Args:
        file: GeoTIFF file

    Returns:
        JSON with base64 PNG and geographic bounds
    """
    import rasterio
    from rasterio.warp import calculate_default_transform, reproject, Resampling
    import tempfile

    try:
        # Validate file type
        if not file.filename.lower().endswith(('.tif', '.tiff')):
            raise HTTPException(
                status_code=400,
                detail="Only TIFF/GeoTIFF files are supported"
            )

        # Save uploaded file to temp location
        with tempfile.NamedTemporaryFile(delete=False, suffix='.tif') as tmp:
            contents = await file.read()
            tmp.write(contents)
            tmp_path = tmp.name

        try:
            # Open GeoTIFF with rasterio
            with rasterio.open(tmp_path) as src:
                # Get bounds in original CRS
                bounds = src.bounds

                # If CRS is not WGS84, transform bounds
                if src.crs and src.crs.to_epsg() != 4326:
                    from rasterio.warp import transform_bounds
                    bounds = transform_bounds(src.crs, 'EPSG:4326', *bounds)

                # Get nodata value
                nodata = src.nodata

                # Read image data (handle different band counts)
                if src.count == 1:
                    # Grayscale
                    data = src.read(1)

                    # Create mask for valid data
                    if nodata is not None:
                        valid_mask = data != nodata
                    else:
                        valid_mask = ~np.isnan(data)

                    # Normalize using percentile clipping (2-98%) for better contrast
                    valid_data = data[valid_mask]
                    if len(valid_data) > 0:
                        p2, p98 = np.percentile(valid_data, [2, 98])
                        data_clipped = np.clip(data, p2, p98)
                        if p98 > p2:
                            data_norm = ((data_clipped - p2) / (p98 - p2) * 255).astype(np.uint8)
                        else:
                            data_norm = np.zeros_like(data, dtype=np.uint8)
                    else:
                        data_norm = np.zeros_like(data, dtype=np.uint8)

                    # Convert to RGBA to support transparency
                    img = Image.fromarray(data_norm, mode='L').convert('RGBA')
                    # Set nodata pixels to transparent
                    alpha = np.where(valid_mask, 255, 0).astype(np.uint8)
                    img.putalpha(Image.fromarray(alpha))

                elif src.count >= 3:
                    # RGB or more bands
                    # Read first 3 bands as RGB
                    r = src.read(1)
                    g = src.read(2)
                    b = src.read(3)

                    # Create mask for valid data (check all bands)
                    if nodata is not None:
                        valid_mask = (r != nodata) & (g != nodata) & (b != nodata)
                    else:
                        valid_mask = ~(np.isnan(r) | np.isnan(g) | np.isnan(b))

                    # Normalize each band using percentile clipping
                    def normalize_band(band, mask):
                        valid_data = band[mask]
                        if len(valid_data) > 0:
                            p2, p98 = np.percentile(valid_data, [2, 98])
                            band_clipped = np.clip(band, p2, p98)
                            if p98 > p2:
                                return ((band_clipped - p2) / (p98 - p2) * 255).astype(np.uint8)
                        return np.zeros_like(band, dtype=np.uint8)

                    r_norm = normalize_band(r, valid_mask)
                    g_norm = normalize_band(g, valid_mask)
                    b_norm = normalize_band(b, valid_mask)

                    # Stack into RGBA
                    rgb = np.dstack((r_norm, g_norm, b_norm))
                    img = Image.fromarray(rgb, mode='RGB').convert('RGBA')
                    # Set nodata pixels to transparent
                    alpha = np.where(valid_mask, 255, 0).astype(np.uint8)
                    img.putalpha(Image.fromarray(alpha))

                else:
                    raise HTTPException(
                        status_code=400,
                        detail=f"Unsupported band count: {src.count}"
                    )

                # Resize if image is too large (max 4096x4096)
                max_size = 4096
                if img.width > max_size or img.height > max_size:
                    img.thumbnail((max_size, max_size), Image.Resampling.LANCZOS)

                # Convert to PNG base64
                buffer = io.BytesIO()
                img.save(buffer, format='PNG')
                img_base64 = base64.b64encode(buffer.getvalue()).decode('utf-8')

                # Return image and bounds
                return {
                    "success": True,
                    "image": img_base64,
                    "bounds": {
                        "west": bounds[0],
                        "south": bounds[1],
                        "east": bounds[2],
                        "north": bounds[3]
                    },
                    "width": img.width,
                    "height": img.height
                }

        finally:
            # Clean up temp file
            if os.path.exists(tmp_path):
                os.unlink(tmp_path)

    except HTTPException:
        raise
    except Exception as e:
        import traceback
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=f"TIFF processing failed: {str(e)}")
