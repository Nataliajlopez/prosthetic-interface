from fastapi import APIRouter, WebSocket, WebSocketDisconnect
from app.services.sync_engine import engine

router = APIRouter()

@router.websocket("/ws/stream")
async def websocket_endpoint(websocket: WebSocket):
    await websocket.accept()
    try:
        # Subscribe to the 125Hz Sync Engine
        async for packet in engine.stream_generator():
            if packet:
                await websocket.send_json(packet)
    except WebSocketDisconnect:
        print("Client disconnected")