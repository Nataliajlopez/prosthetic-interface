from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from typing import Dict, Any
from app.services.ble_service import ble_manager

router = APIRouter()

class ConnectRequest(BaseModel):
    address: str
    topology: Dict[str, Any] # The JSON you want to send to the device

@router.get("/scan")
async def scan_devices():
    return await ble_manager.scan()

@router.post("/connect")
async def connect_device(req: ConnectRequest):
    try:
        success = await ble_manager.connect(req.address, req.topology)
        return {"status": "connected", "topology_sent": True}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.post("/disconnect")
async def disconnect_device():
    await ble_manager.disconnect()
    return {"status": "disconnected"}