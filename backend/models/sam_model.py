# SAM Model Integration - Optimized Version

import torch
import numpy as np
from segment_anything import sam_model_registry, SamPredictor
from PIL import Image
import cv2
from typing import List, Tuple, Optional
import os

class SAMSegmenter:
    def __init__(self, model_type: str = "vit_h", checkpoint_path: str = None):
        """
        Initialize SAM model

        Args:
            model_type: Model type (vit_h, vit_l, vit_b)
            checkpoint_path: Path to model checkpoint
        """
        self.device = "cuda" if torch.cuda.is_available() else "cpu"
        self.model_type = model_type

        if checkpoint_path is None:
            # Default checkpoint path
            checkpoint_path = os.path.join(
                os.path.dirname(__file__),
                "checkpoints",
                f"sam_{model_type}.pth"
            )

        if not os.path.exists(checkpoint_path):
            raise FileNotFoundError(
                f"Model checkpoint not found at {checkpoint_path}. "
                "Please download SAM checkpoint from: "
                "https://github.com/facebookresearch/segment-anything#model-checkpoints"
            )

        print(f"Loading SAM model ({model_type}) on {self.device}...")
        self.sam = sam_model_registry[model_type](checkpoint=checkpoint_path)
        self.sam.to(device=self.device)
        self.predictor = SamPredictor(self.sam)
        print(f"SAM model loaded successfully!")

    def set_image(self, image: np.ndarray):
        """Set image for segmentation"""
        self.predictor.set_image(image)

    def segment_from_points(
        self,
        points: List[Tuple[float, float]],
        labels: List[int],
        multimask_output: bool = True
    ) -> np.ndarray:
        """
        Segment image based on point prompts

        Args:
            points: List of (x, y) coordinates
            labels: List of labels (1 for foreground, 0 for background)
            multimask_output: If True, returns best of 3 masks; if False, returns 1 mask

        Returns:
            Binary mask of segmentation
        """
        point_coords = np.array(points)
        point_labels = np.array(labels)

        masks, scores, logits = self.predictor.predict(
            point_coords=point_coords,
            point_labels=point_labels,
            multimask_output=multimask_output,
        )

        # Return the mask with highest score
        if multimask_output:
            best_mask_idx = np.argmax(scores)
            return masks[best_mask_idx]
        else:
            return masks[0]

    def segment_from_box(
        self,
        box: Tuple[float, float, float, float]
    ) -> np.ndarray:
        """
        Segment image based on bounding box

        Args:
            box: Bounding box as (x_min, y_min, x_max, y_max)

        Returns:
            Binary mask of segmentation
        """
        box_np = np.array(box)
        masks, scores, logits = self.predictor.predict(
            box=box_np,
            multimask_output=False,
        )
        return masks[0]

    def mask_to_polygon(
        self,
        mask: np.ndarray,
        simplify_tolerance: float = 1.0
    ) -> List[List[Tuple[int, int]]]:
        """
        Convert binary mask to polygon contours

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

    def get_model_info(self) -> dict:
        """Get model information"""
        return {
            "model_type": self.model_type,
            "device": str(self.device),
            "cuda_available": torch.cuda.is_available(),
            "model_loaded": self.sam is not None
        }


# Singleton instance
_sam_instance = None

def get_sam_instance(model_type: str = "vit_h", checkpoint_path: str = None) -> SAMSegmenter:
    """Get or create SAM instance"""
    global _sam_instance
    if _sam_instance is None:
        _sam_instance = SAMSegmenter(model_type, checkpoint_path)
    return _sam_instance
