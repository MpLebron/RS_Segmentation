# SAM3 Model Integration using segment-geospatial (samgeo)

import torch
import numpy as np
from typing import List, Tuple, Dict, Optional
import os
import tempfile
import cv2
from PIL import Image

# Ensure Hugging Face token is set for model downloads
# Check HUGGINGFACE_TOKEN first, then fall back to HF_TOKEN
if os.getenv('HUGGINGFACE_TOKEN') and not os.getenv('HF_TOKEN'):
    os.environ['HF_TOKEN'] = os.getenv('HUGGINGFACE_TOKEN')

# Try importing samgeo - gracefully handle if not installed
try:
    from samgeo import SamGeo, SamGeo2, SamGeo3
    SAMGEO_AVAILABLE = True
except ImportError:
    try:
        from samgeo import SamGeo, SamGeo2
        SAMGEO_AVAILABLE = True
        SamGeo3 = None  # Mark as not available
    except ImportError:
        print("Warning: samgeo not installed. SAM3 features will not be available.")
        print("Install with: pip install segment-geospatial[samgeo3]")
        SAMGEO_AVAILABLE = False
        SamGeo3 = None


class SAM3Segmenter:
    """
    SAM3 model wrapper using segment-geospatial (samgeo) package.
    Provides unified interface for text prompts, automatic segmentation, and point prompts.
    """

    def __init__(self, model_type: str = "vit_h", checkpoint_path: str = None, use_sam3: bool = True):
        """
        Initialize SAM3 segmenter using samgeo package.

        Args:
            model_type: Model type (vit_h, vit_l, vit_b)
            checkpoint_path: Optional path to model checkpoint (samgeo auto-downloads if None)
            use_sam3: If True, use SAM3; if False, fallback to SAM 1.0
        """
        if not SAMGEO_AVAILABLE:
            raise ImportError(
                "segment-geospatial package not installed. "
                "Install with: pip install segment-geospatial[samgeo3]"
            )

        self.device = "cuda" if torch.cuda.is_available() else "cpu"
        self.model_type = model_type
        self.use_sam3 = use_sam3
        self.current_image = None
        self.current_image_path = None
        self.temp_dir = tempfile.mkdtemp(prefix="guzhu_sam3_")

        print(f"Initializing SAM{'3' if use_sam3 else ''} model ({model_type}) on {self.device}...")

        # Initialize appropriate SAM model
        try:
            if use_sam3 and SamGeo3 is not None:
                # Try SAM3 first (requires Hugging Face authentication)
                self.sam = SamGeo3(
                    model_type=model_type,
                    checkpoint=checkpoint_path,
                    device=self.device
                )
                print("SAM3 model loaded successfully!")
            else:
                raise AttributeError("Fallback to SAM2")
        except (ImportError, AttributeError, Exception) as e:
            # Fallback to SAM2 if SAM3 not available
            print(f"SAM3 not available ({str(e)[:50]}...), using SAM2 as fallback...")
            self.sam = SamGeo2(
                model_type=model_type,
                checkpoint=checkpoint_path,
                device=self.device
            )
            self.use_sam3 = False
            print("SAM2 model loaded successfully!")

    def set_image(self, image: np.ndarray, temp_filename: str = None):
        """
        Set image for segmentation.

        Args:
            image: Image as numpy array (H, W, 3) in RGB format
            temp_filename: Optional temporary filename (will be auto-generated if None)
        """
        self.current_image = image

        # samgeo requires file path, so save image temporarily
        if temp_filename is None:
            temp_filename = os.path.join(self.temp_dir, "current_image.png")

        self.current_image_path = temp_filename

        # Save image
        Image.fromarray(image).save(temp_filename)
        print(f"Image saved to temporary path: {temp_filename}")

    def segment_from_text(
        self,
        text_prompt: str,
        output_format: str = "geojson"
    ) -> List[Dict]:
        """
        Segment image using text prompt (SAM3 feature).

        Args:
            text_prompt: Text description of objects to segment (e.g., "buildings", "trees")
            output_format: Output format ("geojson", "masks")

        Returns:
            List of segmentation results with masks and metadata
        """
        if self.current_image_path is None:
            raise ValueError("No image set. Call set_image() first.")

        if not self.use_sam3:
            raise NotImplementedError(
                "Text prompts require SAM3. Current model does not support this feature."
            )

        print(f"Segmenting with text prompt: '{text_prompt}'...")

        # Create output directory
        output_dir = os.path.join(self.temp_dir, "text_output")
        os.makedirs(output_dir, exist_ok=True)

        # Use samgeo's text prompt feature
        # Note: API might vary depending on samgeo version
        try:
            self.sam.generate(
                source=self.current_image_path,
                output=os.path.join(output_dir, "segments.tif"),
                foreground=True,
                text_prompt=text_prompt,  # SAM3 specific parameter
                erosion_kernel=(3, 3),
                mask_multiplier=255
            )
        except TypeError:
            # Fallback if text_prompt parameter not supported
            raise NotImplementedError(
                "Text prompt segmentation not supported by current samgeo version. "
                "Ensure you have the latest version with SAM3 support."
            )

        # Load and convert results
        results = self._load_segmentation_results(
            output_dir,
            class_label=text_prompt
        )

        print(f"Found {len(results)} objects matching '{text_prompt}'")
        return results

    def segment_automatic(self) -> List[Dict]:
        """
        Automatically segment all objects in the image (no prompts needed).

        Returns:
            List of segmentation results with masks and metadata
        """
        if self.current_image_path is None:
            raise ValueError("No image set. Call set_image() first.")

        print("Performing automatic segmentation...")

        # Create output directory
        output_dir = os.path.join(self.temp_dir, "auto_output")
        os.makedirs(output_dir, exist_ok=True)

        # Use samgeo's automatic segmentation
        self.sam.generate(
            source=self.current_image_path,
            output=os.path.join(output_dir, "segments.tif"),
            foreground=True,
            erosion_kernel=(3, 3),
            mask_multiplier=255
        )

        # Load and convert results
        results = self._load_segmentation_results(
            output_dir,
            class_label="auto"
        )

        print(f"Found {len(results)} objects via automatic segmentation")
        return results

    def segment_from_points(
        self,
        points: List[Tuple[float, float]],
        labels: List[int],
        multimask_output: bool = True
    ) -> np.ndarray:
        """
        Segment image based on point prompts (backward compatible with SAM 1.0).

        Args:
            points: List of (x, y) coordinates
            labels: List of labels (1 for foreground, 0 for background)
            multimask_output: If True, returns best of 3 masks

        Returns:
            Binary mask of segmentation
        """
        if self.current_image is None:
            raise ValueError("No image set. Call set_image() first.")

        point_coords = np.array(points)
        point_labels = np.array(labels)

        print(f"Segmenting with {len(points)} point(s)...")

        # Use samgeo's predict method (similar to SAM 1.0)
        try:
            masks, scores, logits = self.sam.predict(
                point_coords=point_coords,
                point_labels=point_labels,
                multimask_output=multimask_output
            )

            # Return the mask with highest score
            if multimask_output:
                best_mask_idx = np.argmax(scores)
                return masks[best_mask_idx]
            else:
                return masks[0]
        except AttributeError:
            # If predict method not available, use alternative approach
            raise NotImplementedError(
                "Point-based segmentation not directly supported. "
                "Consider using segment_from_box or automatic segmentation."
            )

    def mask_to_polygon(
        self,
        mask: np.ndarray,
        simplify_tolerance: float = 1.0
    ) -> List[List[Tuple[int, int]]]:
        """
        Convert binary mask to polygon contours.
        Reuses logic from original sam_model.py for consistency.

        Args:
            mask: Binary mask
            simplify_tolerance: Tolerance for polygon simplification (higher = simpler)

        Returns:
            List of polygon contours
        """
        # Convert mask to uint8
        mask_uint8 = (mask * 255).astype(np.uint8)

        # Find contours
        contours, _ = cv2.findContours(
            mask_uint8,
            cv2.RETR_EXTERNAL,
            cv2.CHAIN_APPROX_SIMPLE
        )

        # Convert contours to list of points
        polygons = []
        for contour in contours:
            if len(contour) >= 3:  # Valid polygon needs at least 3 points
                # Simplify polygon to reduce point count
                epsilon = simplify_tolerance
                approx = cv2.approxPolyDP(contour, epsilon, True)

                polygon = approx.squeeze().tolist()
                if isinstance(polygon[0], list):
                    polygons.append(polygon)
                elif len(polygon) >= 3:  # Ensure it's still a valid polygon
                    polygons.append([polygon])

        return polygons

    def _load_segmentation_results(
        self,
        output_dir: str,
        class_label: str = "unknown"
    ) -> List[Dict]:
        """
        Load segmentation results from samgeo output directory.

        Args:
            output_dir: Directory containing samgeo output
            class_label: Class label to assign to all segments

        Returns:
            List of dictionaries with 'mask', 'class', and other metadata
        """
        results = []

        # samgeo typically outputs GeoTIFF with masks
        # We need to read and parse this
        # For now, this is a placeholder - actual implementation depends on samgeo output format

        # TODO: Implement GeoTIFF reading and mask extraction
        # This would involve:
        # 1. Reading the output GeoTIFF file
        # 2. Extracting individual masks/segments
        # 3. Converting to our internal format

        print(f"Warning: _load_segmentation_results not fully implemented yet")
        print(f"Output directory: {output_dir}")

        return results

    def get_model_info(self) -> dict:
        """Get model information."""
        return {
            "model_type": self.model_type,
            "device": str(self.device),
            "cuda_available": torch.cuda.is_available(),
            "model_loaded": self.sam is not None,
            "using_sam3": self.use_sam3
        }

    def cleanup(self):
        """Clean up temporary files."""
        import shutil
        if os.path.exists(self.temp_dir):
            shutil.rmtree(self.temp_dir)
            print(f"Cleaned up temporary directory: {self.temp_dir}")

    def __del__(self):
        """Destructor to ensure cleanup."""
        self.cleanup()


# Singleton instance for SAM3
_sam3_instance = None


def get_sam3_instance(
    model_type: str = "vit_h",
    checkpoint_path: str = None,
    use_sam3: bool = True
) -> SAM3Segmenter:
    """
    Get or create SAM3 instance (singleton pattern).

    Args:
        model_type: Model type (vit_h, vit_l, vit_b)
        checkpoint_path: Optional path to model checkpoint
        use_sam3: If True, use SAM3; if False, use SAM2/SAM1

    Returns:
        SAM3Segmenter instance
    """
    global _sam3_instance
    if _sam3_instance is None:
        _sam3_instance = SAM3Segmenter(model_type, checkpoint_path, use_sam3)
    return _sam3_instance
