# GuZhu Backend Setup

## Installation

1. Create virtual environment:
```bash
python -m venv venv
source venv/bin/activate  # On Windows: venv\Scripts\activate
```

2. Install dependencies:
```bash
pip install -r requirements.txt
```

3. Download SAM model checkpoint:

Download one of the SAM model checkpoints from:
https://github.com/facebookresearch/segment-anything#model-checkpoints

Recommended: `vit_h` (default, best quality)
- ViT-H SAM model: [sam_vit_h_4b8939.pth](https://dl.fbaipublicfiles.com/segment_anything/sam_vit_h_4b8939.pth)

Alternative models:
- ViT-L SAM model: [sam_vit_l_0b3195.pth](https://dl.fbaipublicfiles.com/segment_anything/sam_vit_l_0b3195.pth)
- ViT-B SAM model: [sam_vit_b_01ec64.pth](https://dl.fbaipublicfiles.com/segment_anything/sam_vit_b_01ec64.pth)

4. Place the checkpoint file in:
```
backend/models/checkpoints/sam_vit_h.pth
```

Or create the directory:
```bash
mkdir -p models/checkpoints
# Then move your downloaded .pth file there
```

## Running the Server

```bash
uvicorn app.main:app --reload --port 8000
```

The API will be available at: http://localhost:8000

## API Endpoints

- `GET /` - Root endpoint
- `GET /health` - Health check
- `GET /api/model-info` - Model information
- `POST /api/segment` - Segment image with SAM

## Testing

Test the health endpoint:
```bash
curl http://localhost:8000/health
```
