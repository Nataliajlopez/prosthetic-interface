import asyncio
import time
import json
from collections import deque
from app.config import settings

class SyncEngine:
    def __init__(self):
        self.buffer = deque(maxlen=2000)
        self.running = False
        self.latest_topology = None # Stores the handshake data

    def push_packet(self, packet: dict):
        """Called by BLE Service when a burst arrives."""
        self.buffer.append(packet)

    def set_topology(self, topology: dict):
        self.latest_topology = topology

    async def stream_generator(self):
        """
        The Heartbeat: Yields data exactly at 125Hz.
        """
        self.running = True
        next_tick = time.time()

        while self.running:
            now = time.time()
            
            # 1. Wait for the strict 8ms tick
            if now < next_tick:
                await asyncio.sleep(next_tick - now)
            
            # 2. Pop the oldest data (FIFO)
            if self.buffer:
                # Send data + current buffer health (for debugging lag)
                data = self.buffer.popleft()
                yield data
            else:
                # Buffer Underrun: Send keepalive or nothing
                yield None

            next_tick += settings.TICK_INTERVAL

    def stop(self):
        self.running = False

# Singleton Instance
engine = SyncEngine()