from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from app.api.routes import router as api_router
from app.api.websocket import router as ws_router

app = FastAPI(title="Prosthetic Controller Lite")

# CORS (Allow your Vite frontend)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Register Routes
app.include_router(api_router, prefix="/api")
app.include_router(ws_router)

if __name__ == "__main__":
    import uvicorn
    # This will run with almost 0 startup time
    uvicorn.run(app, host="0.0.0.0", port=8000)