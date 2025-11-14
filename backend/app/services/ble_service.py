import asyncio
import json
from bleak import BleakScanner, BleakClient
from app.config import settings
from app.services.sync_engine import engine

class BLEService:
    def __init__(self):
        self.client = None
        self.is_connected = False
        self.rx_buffer = "" # String buffer for incomplete CSV lines

    async def scan(self):
        devices = await BleakScanner.discover()
        return [{"name": d.name or "Unknown", "address": d.address} for d in devices]

    async def connect(self, address: str, topology_data: dict):
        """
        Connects AND performs the JSON handshake.
        """
        if self.client:
            await self.disconnect()

        self.client = BleakClient(address)
        await self.client.connect()
        self.is_connected = True
        
        # 1. The Handshake: Send Topology JSON
        print(f"Connected to {address}. Sending topology...")
        topology_bytes = json.dumps(topology_data).encode('utf-8')
        
        # Assuming your device listens on the TX characteristic
        await self.client.write_gatt_char(settings.UART_TX_CHAR_UUID, topology_bytes)
        print("Topology sent.")

        # 2. Store Topology in Sync Engine (for the frontend to reference)
        engine.set_topology(topology_data)

        # 3. Start Listening
        await self.client.start_notify(settings.UART_RX_CHAR_UUID, self._handle_notification)
        return True

    async def disconnect(self):
        if self.client:
            try:
                await self.client.disconnect()
            except:
                pass
        self.client = None
        self.is_connected = False
        engine.stop()

    def _handle_notification(self, sender, data: bytearray):
        """
        Parses CSV bursts: "ms,hh:mm:ss,name,ch0,ch1..."
        """
        try:
            text_chunk = data.decode("utf-8", errors="ignore")
            self.rx_buffer += text_chunk

            while "\n" in self.rx_buffer:
                line, self.rx_buffer = self.rx_buffer.split("\n", 1)
                line = line.strip()
                
                if not line or line.startswith("["): 
                    continue # Ignore debug lines
                
                # CSV Parse (Adapted from your ble_manager.py)
                parts = line.split(",")
                
                # Basic validation to ensure it's data
                if len(parts) >= 2:
                    try:
                        # Assuming last N parts are floats
                        values = [float(x) for x in parts if x.replace('.','',1).isdigit()]
                        
                        packet = {
                            "t": time.time(),
                            "raw": values
                        }
                        # Push to the 125Hz Jitter Buffer
                        engine.push_packet(packet)
                    except ValueError:
                        continue
        except Exception as e:
            print(f"Parse Error: {e}")

ble_manager = BLEService()