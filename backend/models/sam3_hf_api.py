# SAM3 Hugging Face API Integration
# Uses Hugging Face Inference API instead of local SAM3 deployment

import os
import base64
import requests
from requests.adapters import HTTPAdapter
from urllib3.util.retry import Retry
import numpy as np
from typing import List, Dict, Optional, Tuple
from PIL import Image
import io
import cv2
import ssl


class SAM3HFAPISegmenter:
    """
    SAM3 segmenter using Hugging Face Inference API.
    This avoids the need for complex local SAM3 dependencies (triton, etc.)
    """

    def __init__(self, hf_token: str = None):
        """
        Initialize SAM3 HF API client.

        Args:
            hf_token: Hugging Face API token. If None, reads from environment.
        """
        self.hf_token = hf_token or os.getenv('HUGGINGFACE_TOKEN') or os.getenv('HF_TOKEN')
        if not self.hf_token:
            raise ValueError("Hugging Face token required. Set HUGGINGFACE_TOKEN environment variable.")

        # SAM3 model on Hugging Face
        self.model_id = "facebook/sam3"
        # Updated API endpoint (old api-inference.huggingface.co is deprecated)
        self.api_url = f"https://router.huggingface.co/models/{self.model_id}"

        self.headers = {
            "Authorization": f"Bearer {self.hf_token}"
        }

        # Create session with retry strategy
        self.session = requests.Session()
        retry_strategy = Retry(
            total=3,
            backoff_factor=1,
            status_forcelist=[429, 500, 502, 503, 504],
            allowed_methods=["HEAD", "GET", "POST"]
        )
        adapter = HTTPAdapter(max_retries=retry_strategy)
        self.session.mount("https://", adapter)
        self.session.mount("http://", adapter)

        # Configure proxy from environment variables
        http_proxy = os.getenv('HTTP_PROXY') or os.getenv('http_proxy')
        https_proxy = os.getenv('HTTPS_PROXY') or os.getenv('https_proxy')

        if http_proxy or https_proxy:
            proxies = {}
            if http_proxy:
                proxies['http'] = http_proxy
                print(f"使用 HTTP 代理: {http_proxy}")
            if https_proxy:
                proxies['https'] = https_proxy
                print(f"使用 HTTPS 代理: {https_proxy}")
            self.session.proxies.update(proxies)

        self.current_image = None
        self.current_image_pil = None

        print(f"SAM3 HF API client initialized with model: {self.model_id}")

    def set_image(self, image: np.ndarray):
        """
        Set the current image for segmentation.

        Args:
            image: Image as numpy array (H, W, 3) in RGB format
        """
        self.current_image = image
        self.current_image_pil = Image.fromarray(image)
        print(f"Image set: {image.shape}")

    def _encode_image_to_base64(self, image: Image.Image) -> str:
        """Convert PIL Image to base64 string."""
        buffered = io.BytesIO()
        image.save(buffered, format="PNG")
        img_str = base64.b64encode(buffered.getvalue()).decode()
        return img_str

    def segment_from_text(
        self,
        text_prompt: str,
        confidence_threshold: float = 0.3
    ) -> List[Dict]:
        """
        Segment image using text prompt via Hugging Face API.

        Args:
            text_prompt: Text description of objects to segment (e.g., "buildings", "trees")
            confidence_threshold: Minimum confidence for accepting a mask

        Returns:
            List of segmentation results with masks and metadata
        """
        if self.current_image_pil is None:
            raise ValueError("No image set. Call set_image() first.")

        print(f"Sending text segmentation request to HF API: '{text_prompt}'...")

        # Convert image to base64
        img_base64 = self._encode_image_to_base64(self.current_image_pil)

        # Prepare payload for HF Inference API
        # Format based on SAM3 API structure
        payload = {
            "inputs": f"data:image/png;base64,{img_base64}",
            "parameters": {
                "prompt": text_prompt,
                "prompt_type": "text",
                "threshold": confidence_threshold
            }
        }

        try:
            response = self.session.post(
                self.api_url,
                headers=self.headers,
                json=payload,
                timeout=60,
                verify=True  # Ensure SSL verification
            )

            if response.status_code == 503:
                # Model is loading
                return self._handle_model_loading(response, text_prompt, confidence_threshold)

            response.raise_for_status()

            # Parse response
            result = response.json()
            print(f"API response received: {type(result)}")

            # Convert API response to our internal format
            return self._parse_api_response(result, text_prompt)

        except requests.exceptions.SSLError as e:
            error_msg = f"SSL connection error: {str(e)}"
            print(error_msg)
            print("\n⚠️  解决方案:")
            print("1. 检查网络连接和防火墙设置")
            print("2. 尝试使用代理或 VPN")
            print("3. 或者先使用'点击分割'模式（使用本地 SAM 1.0）")
            raise RuntimeError(f"无法连接到 Hugging Face API: SSL错误。请检查网络设置或使用点击分割模式。")
        except requests.exceptions.ConnectionError as e:
            error_msg = f"Connection error: {str(e)}"
            print(error_msg)
            raise RuntimeError(f"无法连接到 Hugging Face API: 网络错误。请检查网络连接。")
        except requests.exceptions.Timeout as e:
            error_msg = f"Request timeout: {str(e)}"
            print(error_msg)
            raise RuntimeError(f"Hugging Face API 请求超时。请稍后重试或使用点击分割模式。")
        except requests.exceptions.RequestException as e:
            print(f"API request failed: {e}")
            if hasattr(e, 'response') and e.response is not None:
                print(f"Response status: {e.response.status_code}")
                print(f"Response body: {e.response.text[:500]}")
            raise

    def _handle_model_loading(self, response, text_prompt: str, confidence_threshold: float) -> List[Dict]:
        """Handle the case when model is loading on HF servers."""
        import time
        import json

        try:
            error_data = response.json()
            estimated_time = error_data.get('estimated_time', 20)
            print(f"Model is loading on HF servers. Estimated time: {estimated_time}s")
            print("Waiting and retrying...")

            time.sleep(min(estimated_time + 5, 30))

            # Retry the request
            return self.segment_from_text(text_prompt, confidence_threshold)
        except:
            raise RuntimeError(f"Model is loading. Please try again in a few moments.")

    def _parse_api_response(self, api_result, class_label: str) -> List[Dict]:
        """
        Parse Hugging Face API response into our internal format.

        Args:
            api_result: Raw API response
            class_label: Class label for the masks

        Returns:
            List of segmentation results
        """
        results = []

        # HF API response format varies by model
        # Common formats: list of masks, or dict with 'masks' key
        if isinstance(api_result, list):
            masks_data = api_result
        elif isinstance(api_result, dict) and 'masks' in api_result:
            masks_data = api_result['masks']
        else:
            print(f"Unexpected API response format: {api_result}")
            # Return empty for now, can be extended based on actual API response
            return []

        for i, mask_data in enumerate(masks_data):
            # Extract mask and score
            if isinstance(mask_data, dict):
                mask = mask_data.get('mask', None)
                score = mask_data.get('score', 1.0)
            else:
                mask = mask_data
                score = 1.0

            if mask is not None:
                results.append({
                    'mask': np.array(mask),
                    'score': score,
                    'class': class_label,
                    'id': i
                })

        print(f"Parsed {len(results)} masks from API response")
        return results

    def segment_automatic(self) -> List[Dict]:
        """
        Automatically segment all objects in image via HF API.

        Note: This may not be directly supported by HF Inference API.
        As a fallback, we'll try segmenting with a generic prompt.

        Returns:
            List of segmentation results
        """
        if self.current_image_pil is None:
            raise ValueError("No image set. Call set_image() first.")

        print("Attempting automatic segmentation via HF API...")

        # Try with a generic prompt
        # This may not work perfectly - HF API is optimized for specific prompts
        generic_prompts = ["all objects", "everything", "objects"]

        for prompt in generic_prompts:
            try:
                results = self.segment_from_text(prompt, confidence_threshold=0.3)
                if results:
                    return results
            except Exception as e:
                print(f"Failed with prompt '{prompt}': {e}")
                continue

        # If all fail, return empty
        print("Automatic segmentation not available via HF API. Try text prompts instead.")
        return []

    def mask_to_polygon(
        self,
        mask: np.ndarray,
        simplify_tolerance: float = 1.0
    ) -> List[List[Tuple[int, int]]]:
        """
        Convert binary mask to polygon contours.

        Args:
            mask: Binary mask
            simplify_tolerance: Tolerance for polygon simplification

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
                elif len(polygon) >= 3:
                    polygons.append([polygon])

        return polygons

    def get_model_info(self) -> Dict:
        """Get model information."""
        return {
            "model_type": "sam3_hf_api",
            "model_id": self.model_id,
            "device": "remote",
            "backend": "huggingface_inference_api",
            "model_loaded": True
        }


# Singleton instance
_sam3_hf_instance = None


def get_sam3_hf_instance(hf_token: str = None) -> SAM3HFAPISegmenter:
    """
    Get or create SAM3 HF API instance (singleton pattern).

    Args:
        hf_token: Hugging Face API token

    Returns:
        SAM3HFAPISegmenter instance
    """
    global _sam3_hf_instance
    if _sam3_hf_instance is None:
        _sam3_hf_instance = SAM3HFAPISegmenter(hf_token)
    return _sam3_hf_instance
