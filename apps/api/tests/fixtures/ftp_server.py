#!/usr/bin/env python3
"""REAL FTP server for integration tests (pyftpdlib).

Usage: ftp_server.py <port> <root_dir> <username> <password>
Prints "READY <port>" once listening. Plain FTP (test-only, loopback).
"""
import os
import sys

from pyftpdlib.authorizers import DummyAuthorizer
from pyftpdlib.handlers import FTPHandler
from pyftpdlib.servers import FTPServer


def main():
    port = int(sys.argv[1])
    root = sys.argv[2]
    username = sys.argv[3]
    password = sys.argv[4]
    os.makedirs(root, exist_ok=True)

    authorizer = DummyAuthorizer()
    authorizer.add_user(username, password, root, perm="elradfmwMT")

    handler = FTPHandler
    handler.authorizer = authorizer
    handler.passive_ports = range(60000, 60100)

    server = FTPServer(("127.0.0.1", port), handler)
    print(f"READY {port}", flush=True)
    server.serve_forever()


if __name__ == "__main__":
    main()
