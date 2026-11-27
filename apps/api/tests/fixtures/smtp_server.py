#!/usr/bin/env python3
"""Minimal but REAL SMTP server for integration tests (aiosmtpd).

Speaks actual SMTP on 127.0.0.1:<port>; nodemailer performs a genuine
EHLO/MAIL/RCPT/DATA exchange against it. Every accepted message is written
as JSON (envelope + decoded text/html parts) into <outdir>/<n>.json so the
test can read exactly what a mailbox would have received.

Usage: smtp_server.py <port> <outdir>
Prints "READY <port>" on stdout once listening.
"""
import asyncio
import json
import os
import sys
from email import policy
from email.parser import BytesParser

from aiosmtpd.controller import Controller


class Capture:
    def __init__(self, outdir):
        self.outdir = outdir
        self.count = 0

    async def handle_DATA(self, server, session, envelope):
        msg = BytesParser(policy=policy.default).parsebytes(envelope.content)
        text, html = "", ""
        if msg.is_multipart():
            for part in msg.walk():
                ctype = part.get_content_type()
                if ctype == "text/plain" and not text:
                    text = part.get_content()
                elif ctype == "text/html" and not html:
                    html = part.get_content()
        elif msg.get_content_type() == "text/html":
            html = msg.get_content()
        else:
            text = msg.get_content()
        self.count += 1
        record = {
            "mail_from": envelope.mail_from,
            "rcpt_tos": list(envelope.rcpt_tos),
            "subject": str(msg.get("Subject", "")),
            "from": str(msg.get("From", "")),
            "to": str(msg.get("To", "")),
            "text": text,
            "html": html,
        }
        path = os.path.join(self.outdir, f"{self.count:04d}.json")
        with open(path, "w", encoding="utf-8") as fh:
            json.dump(record, fh, ensure_ascii=False)
        return "250 Message accepted for delivery"


def main():
    port = int(sys.argv[1])
    outdir = sys.argv[2]
    os.makedirs(outdir, exist_ok=True)
    controller = Controller(Capture(outdir), hostname="127.0.0.1", port=port)
    controller.start()
    print(f"READY {port}", flush=True)
    try:
        asyncio.get_event_loop().run_forever()
    except KeyboardInterrupt:
        pass
    finally:
        controller.stop()


if __name__ == "__main__":
    main()
