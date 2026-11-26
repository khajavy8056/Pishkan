#!/usr/bin/env python3
"""Minimal but REAL SFTP server for integration tests (paramiko).

Speaks the actual SSH + SFTP protocols on 127.0.0.1:<port>; the Node ssh2
client performs a genuine handshake, password auth, mkdir/fastPut/stat/
readdir/unlink against it. Root is jailed to the given directory.

Usage: sftp_server.py <port> <root_dir> <username> <password> <host_key_file>
Prints "READY <port>" on stdout once listening.
"""
import os
import socket
import sys
import threading
import traceback

import paramiko
from paramiko import SFTPServer, SFTPServerInterface, SFTPAttributes, SFTPHandle, SFTP_OK, SFTP_NO_SUCH_FILE, SFTP_PERMISSION_DENIED


class Server(paramiko.ServerInterface):
    def __init__(self, username, password):
        self.username = username
        self.password = password
        self.event = threading.Event()

    def check_channel_request(self, kind, chanid):
        return paramiko.OPEN_SUCCEEDED if kind == "session" else paramiko.OPEN_FAILED_ADMINISTRATIVELY_PROHIBITED

    def check_auth_password(self, username, password):
        if username == self.username and password == self.password:
            return paramiko.AUTH_SUCCESSFUL
        return paramiko.AUTH_FAILED

    def get_allowed_auths(self, username):
        return "password"

    def check_channel_shell_request(self, channel):
        return False


class SFTPImpl(SFTPServerInterface):
    ROOT = None

    def _real(self, path):
        # Jail every path inside ROOT.
        canon = os.path.realpath(os.path.join(self.ROOT, os.path.normpath(path).lstrip("/")))
        if not canon.startswith(os.path.realpath(self.ROOT)):
            raise ValueError("path escape")
        return canon

    def list_folder(self, path):
        try:
            out = []
            for name in os.listdir(self._real(path)):
                attr = SFTPAttributes.from_stat(os.stat(os.path.join(self._real(path), name)))
                attr.filename = name
                out.append(attr)
            return out
        except OSError:
            return SFTP_NO_SUCH_FILE

    def stat(self, path):
        try:
            return SFTPAttributes.from_stat(os.stat(self._real(path)))
        except OSError:
            return SFTP_NO_SUCH_FILE

    def lstat(self, path):
        return self.stat(path)

    def open(self, path, flags, attr):
        try:
            real = self._real(path)
            binary = "b"
            if (flags & os.O_CREAT) or (flags & os.O_WRONLY) or (flags & os.O_RDWR):
                mode = "w" if (flags & os.O_TRUNC) or (flags & os.O_CREAT) else "r+"
                handle = SFTPHandle(flags)
                handle.filename = real
                f = open(real, mode + binary)
                handle.readfile = f
                handle.writefile = f
                try:
                    os.chmod(real, attr.st_mode & 0o777 if attr.st_mode else 0o600)
                except (OSError, AttributeError):
                    pass
                return handle
            handle = SFTPHandle(flags)
            handle.filename = real
            handle.readfile = open(real, "rb")
            return handle
        except (OSError, ValueError):
            return SFTP_NO_SUCH_FILE

    def remove(self, path):
        try:
            os.remove(self._real(path))
            return SFTP_OK
        except OSError:
            return SFTP_NO_SUCH_FILE

    def mkdir(self, path, attr):
        try:
            os.mkdir(self._real(path))
            return SFTP_OK
        except FileExistsError:
            return SFTP_OK  # idempotent like mkdir -p expects
        except OSError:
            return SFTP_PERMISSION_DENIED

    def rmdir(self, path):
        try:
            os.rmdir(self._real(path))
            return SFTP_OK
        except OSError:
            return SFTP_PERMISSION_DENIED

    def rename(self, oldpath, newpath):
        try:
            os.rename(self._real(oldpath), self._real(newpath))
            return SFTP_OK
        except OSError:
            return SFTP_NO_SUCH_FILE


def serve(port, root, username, password, host_key_file):
    SFTPImpl.ROOT = root
    os.makedirs(root, exist_ok=True)
    if os.path.exists(host_key_file):
        host_key = paramiko.RSAKey.from_private_key_file(host_key_file)
    else:
        host_key = paramiko.RSAKey.generate(2048)
        host_key.write_private_key_file(host_key_file)

    sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    sock.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
    sock.bind(("127.0.0.1", port))
    sock.listen(16)
    print(f"READY {port}", flush=True)

    while True:
        try:
            client, _addr = sock.accept()
        except OSError:
            break

        def handle(client=client):
            transport = None
            try:
                transport = paramiko.Transport(client)
                transport.add_server_key(host_key)
                transport.set_subsystem_handler("sftp", SFTPServer, SFTPImpl)
                server = Server(username, password)
                transport.start_server(server=server)
                channel = transport.accept(30)
                # Keep the transport alive while the client works.
                while transport.is_active():
                    transport.join(1)
            except Exception:
                traceback.print_exc()
            finally:
                try:
                    if transport:
                        transport.close()
                except Exception:
                    pass

        threading.Thread(target=handle, daemon=True).start()


if __name__ == "__main__":
    port = int(sys.argv[1])
    root = sys.argv[2]
    username = sys.argv[3]
    password = sys.argv[4]
    host_key_file = sys.argv[5]
    serve(port, root, username, password, host_key_file)
