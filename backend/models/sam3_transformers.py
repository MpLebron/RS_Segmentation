# SAM3 Implementation using Transformers Library
# Based on official Hugging Face documentation

import torch
import numpy as np
from typing import List, Dict, Optional, Tuple
from PIL import Image
import cv2
import os

# Try importing transformers SAM3
try:
    from transformers import Sam3Model, Sam3Processor
    TRANSFORMERS_SAM3_AVAILABLE = True
except ImportError:
    TRANSFORMERS_SAM3_AVAILABLE = False
    print("Warning: transformers SAM3 not available. Install with: pip install transformers")


class SAM3TransformersSegmenter:
    """
    SAM3 segmenter using Hugging Face Transformers library.
    Supports text prompts for Promptable Concept Segmentation (PCS).
    """

    def __init__(self, model_name: str = "facebook/sam3"):
        """
        Initialize SAM3 using Transformers.

        Args:
            model_name: Hugging Face model name
        """
        if not TRANSFORMERS_SAM3_AVAILABLE:
            raise ImportError(
                "transformers library required. Install with: pip install transformers torch"
            )

        self.device = "cuda" if torch.cuda.is_available() else "cpu"
        print(f"Initializing SAM3 Transformers model on {self.device}...")

        # Load model and processor
        try:
            self.model = Sam3Model.from_pretrained(model_name).to(self.device)
            self.processor = Sam3Processor.from_pretrained(model_name)
            print(f"✓ SAM3 model loaded successfully from {model_name}")
        except Exception as e:
            print(f"✗ Failed to load SAM3 model: {e}")
            raise

        self.current_image = None
        self.current_image_pil = None

    def set_image(self, image: np.ndarray):
        """
        Set the current image for segmentation.

        Args:
            image: Image as numpy array (H, W, 3) in RGB format
        """
        self.current_image = image
        self.current_image_pil = Image.fromarray(image)
        print(f"Image set: {image.shape}")

    def segment_from_text(
        self,
        text_prompt: str,
        confidence_threshold: float = 0.5,
        mask_threshold: float = 0.5
    ) -> List[Dict]:
        """
        Segment image using text prompt (Promptable Concept Segmentation).

        Args:
            text_prompt: Text description (e.g., "buildings", "trees", "cars")
            confidence_threshold: Minimum confidence for accepting an object
            mask_threshold: Threshold for mask binarization

        Returns:
            List of segmentation results with masks and metadata
        """
        if self.current_image_pil is None:
            raise ValueError("No image set. Call set_image() first.")

        print(f"Segmenting with text prompt: '{text_prompt}'...")

        # Prepare inputs
        inputs = self.processor(
            images=self.current_image_pil,
            text=text_prompt,
            return_tensors="pt"
        ).to(self.device)

        # Run inference
        with torch.no_grad():
            outputs = self.model(**inputs)

        # Post-process results
        results_list = self.processor.post_process_instance_segmentation(
            outputs,
            threshold=confidence_threshold,
            mask_threshold=mask_threshold,
            target_sizes=inputs.get("original_sizes").tolist()
        )

        # Convert to our internal format
        if not results_list or len(results_list) == 0:
            print("No objects found")
            return []

        results = results_list[0]  # First image
        masks = results.get('masks', [])
        boxes = results.get('boxes', [])
        scores = results.get('scores', [])

        print(f"Found {len(masks)} objects matching '{text_prompt}'")

        # Format results
        formatted_results = []
        for i, (mask, box, score) in enumerate(zip(masks, boxes, scores)):
            formatted_results.append({
                'mask': mask.cpu().numpy(),
                'box': box.cpu().numpy(),
                'score': score.item() if torch.is_tensor(score) else score,
                'class': text_prompt,
                'id': i
            })

        return formatted_results

    def segment_automatic(self) -> List[Dict]:
        """
        Automatically segment all objects in image.

        Note: SAM3 is designed for text-based prompts. For automatic segmentation,
        we'll use a generic prompt like "objects" or try multiple common categories.

        Returns:
            List of segmentation results
        """
        if self.current_image_pil is None:
            raise ValueError("No image set. Call set_image() first.")

        print("Performing automatic segmentation...")

        # Try multiple generic prompts to catch different object types
        generic_prompts = ["objects", "things", "items"]
        all_results = []
        seen_boxes = set()

        for prompt in generic_prompts:
            try:
                results = self.segment_from_text(prompt, confidence_threshold=0.3)

                # Deduplicate based on box overlap
                for result in results:
                    box = tuple(result['box'].tolist())
                    if box not in seen_boxes:
                        seen_boxes.add(box)
                        all_results.append(result)
            except Exception as e:
                print(f"Failed with prompt '{prompt}': {e}")
                continue

        print(f"Found {len(all_results)} unique objects via automatic segmentation")
        return all_results

    def mask_to_polygon(
        self,
        mask: np.ndarray,
        simplify_tolerance: float = 1.0
    ) -> List[List[Tuple[int, int]]]:
        """
        Convert binary mask to polygon contours.

        Args:
            mask: Binary mask (can be torch.Tensor or numpy array)
            simplify_tolerance: Tolerance for polygon simplification

        Returns:
            List of polygon contours
        """
        # Convert to numpy if needed
        if torch.is_tensor(mask):
            mask = mask.cpu().numpy()

        # Ensure binary mask
        if mask.dtype != np.uint8:
            mask = (mask > 0.5).astype(np.uint8) * 255
        else:
            mask = (mask > 128).astype(np.uint8) * 255

        # Find contours
        contours, _ = cv2.findContours(
            mask,
            cv2.RETR_EXTERNAL,
            cv2.CHAIN_APPROX_SIMPLE
        )

        # Convert contours to list of points
        polygons = []
        for contour in contours:
            if len(contour) >= 3:  # Valid polygon needs at least 3 points
                # Simplify polygon
                epsilon = simplify_tolerance
                approx = cv2.approxPolyDP(contour, epsilon, True)

                polygon = approx.squeeze().tolist()
                if isinstance(polygon[0], list):
                    polygons.append(polygon)
                elif len(polygon) >= 3:
                    polygons.append([polygon])

        return polygons

    def get_model_info(self) -> Dict:
        """Get model information."""
        return {
            "model_type": "sam3_transformers",
            "device": str(self.device),
            "cuda_available": torch.cuda.is_available(),
            "model_loaded": self.model is not None,
            "backend": "huggingface_transformers"
        }


# Singleton instance
_sam3_transformers_instance = None


def get_sam3_transformers_instance(model_name: str = "facebook/sam3") -> SAM3TransformersSegmenter:
    """
    Get or create SAM3 Transformers instance (singleton pattern).

    Args:
        model_name: Hugging Face model name

    Returns:
        SAM3TransformersSegmenter instance
    """
    global _sam3_transformers_instance
    if _sam3_transformers_instance is None:
        _sam3_transformers_instance = SAM3TransformersSegmenter(model_name)
    return _sam3_transformers_instance
