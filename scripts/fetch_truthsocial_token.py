#!/usr/bin/env python3
"""
Helper script that reuses truthbrush's Chrome impersonation to mint a Truth Social OAuth token.
Usage:
  python3 scripts/fetch_truthsocial_token.py --username you@example.com --password secret
"""

import argparse
import json
import sys

try:
  from truthbrush.api import Api, LoginErrorException
except Exception as exc:
  print(
    json.dumps(
      {
        "ok": False,
        "error": "truthbrush import failed",
        "details": str(exc),
        "hint": "pip install --user truthbrush",
      }
    ),
    file=sys.stderr,
  )
  sys.exit(1)


def main() -> int:
  parser = argparse.ArgumentParser(description="Fetch Truth Social OAuth token using truthbrush.")
  parser.add_argument("--username", required=True, help="Truth Social username (email).")
  parser.add_argument("--password", required=True, help="Truth Social password.")
  args = parser.parse_args()

  api = Api(username=args.username, password=args.password)
  try:
    token = api.get_auth_id(args.username, args.password)
  except LoginErrorException as exc:
    print(
      json.dumps({"ok": False, "error": "login failed", "details": str(exc)}),
      file=sys.stderr,
    )
    return 2
  except Exception as exc:
    print(
      json.dumps({"ok": False, "error": "unexpected error", "details": str(exc)}),
      file=sys.stderr,
    )
    return 3

  print(json.dumps({"ok": True, "token": token}))
  return 0


if __name__ == "__main__":
  raise SystemExit(main())
