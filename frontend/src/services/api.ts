// 支持环境变量配置
// 本地开发: http://localhost:8000/api
// 生产环境: /api (通过 nginx 或 Vite 代理)
// 如果 VITE_API_BASE_URL 未设置或为空，使用空字符串（相对路径，通过代理）
const BASE_URL =
  import.meta.env.VITE_API_BASE_URL !== undefined &&
  import.meta.env.VITE_API_BASE_URL !== ""
    ? import.meta.env.VITE_API_BASE_URL
    : "";
const API_BASE_URL =
  BASE_URL === ""
    ? "/api"
    : BASE_URL.endsWith("/api")
      ? BASE_URL
      : `${BASE_URL}/api`;

export interface Point {
  x: number;
  y: number;
  label: number;
}

export interface Bounds {
  west: number;
  south: number;
  east: number;
  north: number;
}

export interface SegmentResponse {
  success: boolean;
  geojson: any;
  text_prompt?: string;
}

export async function segmentImage(
  imageFile: File,
  points: Point[],
  bounds: Bounds,
  minConfidence: number = 0.0,
  minSize?: number,
  maxSize?: number,
): Promise<SegmentResponse> {
  const formData = new FormData();
  formData.append("file", imageFile);
  formData.append("points", JSON.stringify(points));
  formData.append("bounds", JSON.stringify(bounds));
  formData.append("min_confidence", minConfidence.toString());

  if (minSize !== undefined && minSize !== null) {
    formData.append("min_size", minSize.toString());
  }
  if (maxSize !== undefined && maxSize !== null) {
    formData.append("max_size", maxSize.toString());
  }

  const response = await fetch(`${API_BASE_URL}/segment`, {
    method: "POST",
    body: formData,
  });

  if (!response.ok) {
    throw new Error(`HTTP error! status: ${response.status}`);
  }

  return await response.json();
}

export async function segmentImageWithText(
  imageFile: File,
  textPrompt: string,
  bounds: Bounds,
): Promise<SegmentResponse> {
  const formData = new FormData();
  formData.append("file", imageFile);
  formData.append("text_prompt", textPrompt);
  formData.append("bounds", JSON.stringify(bounds));

  const response = await fetch(`${API_BASE_URL}/segment-text`, {
    method: "POST",
    body: formData,
  });

  if (!response.ok) {
    const errorData = await response
      .json()
      .catch(() => ({ detail: "Unknown error" }));
    throw new Error(
      errorData.detail || `HTTP error! status: ${response.status}`,
    );
  }

  return await response.json();
}

export async function segmentImageAuto(
  imageFile: File,
  bounds: Bounds,
  minConfidence: number = 0.8,
  minSize?: number,
  maxSize?: number,
): Promise<SegmentResponse> {
  const formData = new FormData();
  formData.append("file", imageFile);
  formData.append("bounds", JSON.stringify(bounds));
  formData.append("min_confidence", minConfidence.toString());

  if (minSize !== undefined && minSize !== null) {
    formData.append("min_size", minSize.toString());
  }
  if (maxSize !== undefined && maxSize !== null) {
    formData.append("max_size", maxSize.toString());
  }

  const response = await fetch(`${API_BASE_URL}/segment-auto`, {
    method: "POST",
    body: formData,
  });

  if (!response.ok) {
    const errorData = await response
      .json()
      .catch(() => ({ detail: "Unknown error" }));
    throw new Error(
      errorData.detail || `HTTP error! status: ${response.status}`,
    );
  }

  return await response.json();
}

export interface SingleObjectResponse {
  success: boolean;
  feature: any; // GeoJSON Feature
}

export async function segmentSingleObject(
  imageFile: File,
  points: Point[],
  bounds: Bounds,
): Promise<SingleObjectResponse> {
  const formData = new FormData();
  formData.append("file", imageFile);
  formData.append("prompt_type", "point");
  formData.append("prompt_data", JSON.stringify(points));
  formData.append("bounds", JSON.stringify(bounds));

  const response = await fetch(`${API_BASE_URL}/segment-single`, {
    method: "POST",
    body: formData,
  });

  if (!response.ok) {
    const errorData = await response
      .json()
      .catch(() => ({ detail: "Unknown error" }));
    throw new Error(
      errorData.detail || `HTTP error! status: ${response.status}`,
    );
  }

  return await response.json();
}

export interface BatchObjectResponse {
  success: boolean;
  features: any[]; // Array of GeoJSON Features
  total: number;
  successful: number;
}

export async function segmentBatchObjects(
  imageFile: File,
  pointsList: Point[][], // Array of point arrays
  bounds: Bounds,
): Promise<BatchObjectResponse> {
  const formData = new FormData();
  formData.append("file", imageFile);
  formData.append("points_list", JSON.stringify(pointsList));
  formData.append("bounds", JSON.stringify(bounds));

  const response = await fetch(`${API_BASE_URL}/segment-batch`, {
    method: "POST",
    body: formData,
  });

  if (!response.ok) {
    const errorData = await response
      .json()
      .catch(() => ({ detail: "Unknown error" }));
    throw new Error(
      errorData.detail || `HTTP error! status: ${response.status}`,
    );
  }

  return await response.json();
}

export async function healthCheck(): Promise<{
  status: string;
  sam3_available?: boolean;
}> {
  const response = await fetch(`${API_BASE_URL}/health`);

  if (!response.ok) {
    throw new Error(`HTTP error! status: ${response.status}`);
  }

  return await response.json();
}

// 上传 TIFF 文件
export async function uploadTiff(file: File): Promise<{
  success: boolean;
  image: string;
  bounds: Bounds;
}> {
  const formData = new FormData();
  formData.append("file", file);

  const response = await fetch(`${API_BASE_URL}/upload-tiff`, {
    method: "POST",
    body: formData,
  });

  if (!response.ok) {
    throw new Error(`HTTP error! status: ${response.status}`);
  }

  return await response.json();
}

// 导出 Shapefile
export async function exportShapefile(geojson: any): Promise<Blob> {
  const response = await fetch(`${API_BASE_URL}/export-shapefile`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(geojson),
  });

  if (!response.ok) {
    const errorData = await response
      .json()
      .catch(() => ({ detail: "Unknown error" }));
    throw new Error(
      errorData.detail || `Export failed with status ${response.status}`,
    );
  }

  return await response.blob();
}
