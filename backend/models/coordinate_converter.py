from typing import List, Tuple, Dict
import numpy as np


WEB_MERCATOR_MAX_LAT = 85.05112878


def _clamp_lat(lat: float) -> float:
    return max(min(lat, WEB_MERCATOR_MAX_LAT), -WEB_MERCATOR_MAX_LAT)


def _lat_to_mercator_y(lat: float) -> float:
    lat_rad = np.radians(_clamp_lat(lat))
    return float(np.log(np.tan(np.pi / 4.0 + lat_rad / 2.0)))


def _mercator_y_to_lat(y: float) -> float:
    return float(np.degrees(2.0 * np.arctan(np.exp(y)) - np.pi / 2.0))


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

        if self.width <= 0 or self.height <= 0:
            raise ValueError(f"Invalid image size: {image_size}")

        # Preferred mode: exact 4-corner coordinates from frontend viewport.
        # Fallback mode: axis-aligned west/south/east/north bounds.
        self.corners = image_bounds.get("corners")
        if self.corners:
            tl = self.corners["top_left"]
            tr = self.corners["top_right"]
            br = self.corners["bottom_right"]
            bl = self.corners["bottom_left"]

            self._corner_mercator = {
                "top_left": (
                    float(np.radians(tl["lng"])),
                    _lat_to_mercator_y(tl["lat"]),
                ),
                "top_right": (
                    float(np.radians(tr["lng"])),
                    _lat_to_mercator_y(tr["lat"]),
                ),
                "bottom_right": (
                    float(np.radians(br["lng"])),
                    _lat_to_mercator_y(br["lat"]),
                ),
                "bottom_left": (
                    float(np.radians(bl["lng"])),
                    _lat_to_mercator_y(bl["lat"]),
                ),
            }
            self._mode = "corners"
        else:
            self.west = float(image_bounds['west'])
            self.south = float(image_bounds['south'])
            self.east = float(image_bounds['east'])
            self.north = float(image_bounds['north'])

            # Mapbox uses Web Mercator (EPSG:3857), so y/latitude mapping is non-linear.
            # We interpolate in Mercator space to avoid edge drift after zoom/fitBounds.
            self.min_x = float(np.radians(self.west))
            self.max_x = float(np.radians(self.east))
            self.min_y = _lat_to_mercator_y(self.south)
            self.max_y = _lat_to_mercator_y(self.north)

            self.x_per_pixel = (self.max_x - self.min_x) / self.width
            self.y_per_pixel = (self.max_y - self.min_y) / self.height
            self._mode = "bounds"

    def pixel_to_geo(self, x: float, y: float) -> Tuple[float, float]:
        """
        Convert pixel coordinates to geographic coordinates

        Args:
            x: Pixel x coordinate
            y: Pixel y coordinate

        Returns:
            Tuple of (longitude, latitude)
        """
        if self._mode == "corners":
            u = float(x) / float(self.width)
            v = float(y) / float(self.height)

            tlx, tly = self._corner_mercator["top_left"]
            trx, try_ = self._corner_mercator["top_right"]
            brx, bry = self._corner_mercator["bottom_right"]
            blx, bly = self._corner_mercator["bottom_left"]

            # Bilinear interpolation in Web Mercator space
            mercator_x = (
                (1.0 - u) * (1.0 - v) * tlx +
                u * (1.0 - v) * trx +
                u * v * brx +
                (1.0 - u) * v * blx
            )
            mercator_y = (
                (1.0 - u) * (1.0 - v) * tly +
                u * (1.0 - v) * try_ +
                u * v * bry +
                (1.0 - u) * v * bly
            )
        else:
            mercator_x = self.min_x + x * self.x_per_pixel
            mercator_y = self.max_y - y * self.y_per_pixel  # Y axis is inverted

        lng = float(np.degrees(mercator_x))
        lat = _mercator_y_to_lat(mercator_y)
        return (lng, lat)

    def geo_to_pixel(self, lng: float, lat: float) -> Tuple[int, int]:
        """
        Convert geographic coordinates to pixel coordinates

        Args:
            lng: Longitude
            lat: Latitude

        Returns:
            Tuple of (x, y) pixel coordinates
        """
        if self._mode == "corners":
            # Approximate inverse for corners mode by using axis-aligned fallback
            # from declared west/south/east/north if available.
            west = float(self.bounds.get("west", -180.0))
            east = float(self.bounds.get("east", 180.0))
            south = float(self.bounds.get("south", -85.0))
            north = float(self.bounds.get("north", 85.0))
            x = int(round((lng - west) / (east - west) * self.width))
            y = int(round((north - lat) / (north - south) * self.height))
            return x, y

        mercator_x = float(np.radians(lng))
        mercator_y = _lat_to_mercator_y(lat)
        x = int(round((mercator_x - self.min_x) / self.x_per_pixel))
        y = int(round((self.max_y - mercator_y) / self.y_per_pixel))
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
