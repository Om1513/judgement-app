// App configuration

// Server URL configuration
// For development with Expo Go on a physical device, use your computer's local IP address
// For Android emulator, use 10.0.2.2
// For iOS simulator, use localhost or 127.0.0.1

// To find your local IP:
// - On macOS/Linux: run `ifconfig | grep "inet "` in terminal
// - On Windows: run `ipconfig` in command prompt and look for IPv4 Address

// ==========================================
// WSL2 SETUP REQUIRED:
// ==========================================
// 1. Run this in Windows PowerShell (Admin):
//    netsh interface portproxy add v4tov4 listenport=3001 listenaddress=0.0.0.0 connectport=3001 connectaddress=172.24.8.86
//
// 2. Allow firewall (PowerShell Admin):
//    New-NetFirewallRule -DisplayName "WSL2 Port 3001" -Direction Inbound -Action Allow -Protocol TCP -LocalPort 3001
//
// 3. Find your Windows IP (run `ipconfig` in cmd/PowerShell)
//    Look for "Wireless LAN adapter Wi-Fi" -> IPv4 Address
//
// 4. Replace the IP below with your Windows IPv4 address
// ==========================================

export const SERVER_URL = __DEV__
  ? 'http://192.168.0.21:3001' // Your Windows WiFi IP
  : 'https://your-production-server.com';

// For Android emulator
// export const SERVER_URL = 'http://10.0.2.2:3001';

// For iOS simulator
// export const SERVER_URL = 'http://localhost:3001';

export default {
  SERVER_URL,
};
