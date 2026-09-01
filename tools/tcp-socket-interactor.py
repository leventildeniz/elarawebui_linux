#!/usr/bin/env python3
# @description: Performs raw TCP connections to a host/port, captures the server banner, sends a custom payload, and returns the response.
# @tool: tcp-socket-interactor
import socket
import json
import sys

def main():
    try:
        input_data = json.load(sys.stdin)
        host = input_data.get('host')
        port = int(input_data.get('port', 80))
        payload = input_data.get('payload', '')
        timeout = float(input_data.get('timeout', 5.0))

        result = {"status": "error", "banner": "", "response": "", "error": ""}
        
        with socket.create_connection((host, port), timeout=timeout) as sock:
            # Capture initial banner
            try:
                banner = sock.recv(4096).decode('utf-8', errors='ignore')
                result['banner'] = banner
            except socket.timeout:
                result['banner'] = "No banner received (timeout)"

            # Send payload if provided
            if payload:
                sock.sendall((payload + '\r\n').encode('utf-8'))
                try:
                    response = sock.recv(4096).decode('utf-8', errors='ignore')
                    result['response'] = response
                except socket.timeout:
                    result['response'] = "No response received (timeout)"
            
            result['status'] = "success"

    except Exception as e:
        result = {"status": "error", "error": str(e)}

    print(json.dumps(result))

if __name__ == "__main__":
    main()