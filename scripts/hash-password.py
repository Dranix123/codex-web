#!/usr/bin/env python3
"""Generate a salted scrypt password hash without recording the password."""
import getpass
import hashlib
import secrets
import sys

if not sys.stdin.isatty():
    sys.exit('请直接在终端运行，不要通过参数或管道传入密码。')
password = getpass.getpass('设置访问密码（输入不回显）：')
confirm = getpass.getpass('再次输入密码：')
if not password or password != confirm:
    sys.exit('密码为空或两次输入不一致，请重新运行。')
encoded = password.encode('utf-8')
if len(encoded) > 1024:
    sys.exit('密码过长。')
salt = secrets.token_bytes(16)
key = hashlib.scrypt(encoded, salt=salt, n=32768, r=8, p=1, dklen=64, maxmem=64*1024*1024)
print('scrypt$32768$8$1$' + salt.hex() + '$' + key.hex())
