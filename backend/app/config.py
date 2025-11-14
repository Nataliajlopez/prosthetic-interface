# app/config.py
class Config:
    # Audio/Visual Sync Rate
    SAMPLE_RATE = 100
    TICK_INTERVAL = 1.0 / SAMPLE_RATE  # 0.008s (8ms)

    # BLE Settings
    UART_SERVICE_UUID = "6e400001-b5a3-f393-e0a9-e50e24dcca9e"
    UART_RX_CHAR_UUID = "6e400003-b5a3-f393-e0a9-e50e24dcca9e" # Notify
    UART_TX_CHAR_UUID = "6e400002-b5a3-f393-e0a9-e50e24dcca9e" # Write (for handshake)

settings = Config()