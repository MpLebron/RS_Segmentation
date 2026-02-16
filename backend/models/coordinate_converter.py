from pyproj import Transformer
from typing import List, Tuple, Dict
import numpy as np

class CoordinateConverter:
    """Convert between pixel coordinates and geographic coordinates"""

    def __init__(self, image_bounds: Dict[str, float], image_size: Tuple[int, int]):
        """
        Initialize coordinate converter

        Args:
            image_bounds: Dict with keys 'west', 'south', 'east', 'north' (in degrees)
            image_size: Tuple of (width, height) in pixels
        """
        self.bounds = image_bounds
        self.width, self.height = image_size

        # Calculate pixel to degree ratios
        self.lng_per_pixel = (image_bounds['east'] - image_bounds['west']) / self.width
        self.lat_per_pixel = (image_bounds['north'] - image_bounds['south']) / self.height

    def pixel_to_geo(self, x: float, y: float) -> Tuple[float, float]:
        """
        Convert pixel coordinates to geographic coordinates

        Args:
            x: Pixel x coordinate
            y: Pixel y coordinate

        Returns:
            Tuple of (longitude, latitude)
        """
        lng = self.bounds['west'] + x * self.lng_per_pixel
        lat = self.bounds['north'] - y * self.lat_per_pixel  # Y axis is inverted
        return lng, lat

    def geo_to_pixel(self, lng: float, lat: float) -> Tuple[int, int]:
        """
        Convert geographic coordinates to pixel coordinates

        Args:
            lng: Longitude
            lat: Latitude

        Returns:
            Tuple of (x, y) pixel coordinates
        """
        x = int((lng - self.bounds['west']) / self.lng_per_pixel)
        y = int((self.bounds['north'] - lat) / self.lat_per_pixel)
        return x, y

    def polygon_to_geojson(
        self,
        polygon: List[Tuple[int, int]],
        properties: Dict = None
    ) -> Dict:
        """
        Convert pixel polygon to GeoJSON feature

        Args:
            polygon: List of (x, y) pixel coordinates
            properties: Optional properties dict

        Returns:
            GeoJSON Feature dict
        """
        # Convert pixel coordinates to geographic coordinates
        geo_coords = [self.pixel_to_geo(x, y) for x, y in polygon]

        # Close the polygon if not already closed
        if geo_coords[0] != geo_coords[-1]:
            geo_coords.append(geo_coords[0])

        feature = {
            "type": "Feature",
            "geometry": {
                "type": "Polygon",
                "coordinates": [geo_coords]
            },
            "properties": properties or {}
        }

        return feature

    def mask_to_geojson(
        self,
        polygons: List[List[Tuple[int, int]]],
        properties: Dict = None
    ) -> Dict:
        """
        Convert multiple polygons to GeoJSON FeatureCollection

        Args:
            polygons: List of polygons (each polygon is a list of (x, y) coordinates)
            properties: Optional properties dict

        Returns:
            GeoJSON FeatureCollection dict
        """
        features = []
        for i, polygon in enumerate(polygons):
            props = properties.copy() if properties else {}
            props['id'] = i
            feature = self.polygon_to_geojson(polygon, props)
            features.append(feature)

        return {
            "type": "FeatureCollection",
            "features": features
        }
