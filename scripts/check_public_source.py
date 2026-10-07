"""Check publishable files without printing credential values. Standard library only."""
import argparse
import collections
import json
import math
from pathlib import Path
import re
import subprocess


ROOT = Path(__file__).resolve().parents[1]
LOCAL_DIRECTORIES = {
    ".git", ".venv", "node_modules", ".runtime", "__pycache__", "output",
    "dist", "build", ".playwright-cli", ".pytest_cache", ".ruff_cache",
}
PATTERNS = {
    "provider-api-key": re.compile(
        r"(?<![A-Za-z0-9])(?:sk-(?:or-v1-)?[A-Za-z0-9_-]{20,}|"
        r"AIza[A-Za-z0-9_-]{25,}|gh[pousr]_[A-Za-z0-9_]{25,}|"
        r"github_pat_[A-Za-z0-9_]{25,}|AKIA[A-Z0-9]{16})"
    ),
    "private-key": re.compile(
        r"-----BEGIN (?:RSA |EC |OPENSSH |DSA |ENCRYPTED )?PRIVATE KEY-----"
    ),
    "credentials-in-url": re.compile(
        r"(?:https?|postgres(?:ql)?|mysql|mongodb(?:\+srv)?|redis)://"
        r"[^\s/:@]+:[^\s/@]+@"
    ),
    "jwt-token": re.compile(
        r"\beyJ[A-Za-z0-9_-]{15,}\.[A-Za-z0-9_-]{15,}\.[A-Za-z0-9_-]{15,}\b"
    ),
    "personal-machine-path": re.compile(r"/(?:Users|home)/[A-Za-z0-9_.-]+/"),
    "private-deployment-reference": re.compile(
        r"(?:gen-lang-client-[0-9]+|/opt/[a-z]+-studio/|"
        r"[a-z]+-studio-(?:test|staging)[_/-])", re.IGNORECASE
    ),
}
SECRET_ASSIGNMENT = re.compile(
    r"\b(?:[A-Za-z0-9_]*(?:api[_-]?key|access[_-]?token|auth[_-]?token|"
    r"client[_-]?secret|password|secret[_-]?key))[\"']?[ \t]*[=:][ \t]*"
    r"([\"'])([^\n\"']{24,})\1", re.IGNORECASE
)
PRIVATE_FILE = re.compile(
    r"(?:\.(?:pem|key|p12|pfx)$|^(?:credentials|service[-_]account|"
    r"application_default_credentials).*\.json$|^\.(?:npmrc|pypirc|netrc)$)",
    re.IGNORECASE,
)


def entropy(value):
    counts = collections.Counter(value)
    return -sum((count / len(value)) * math.log2(count / len(value)) for count in counts.values())


def inspect_file(path, root):
    relative = path.relative_to(root).as_posix()
    findings = []

    def add(rule, line=1):
        findings.append({"file": relative, "line": line, "rule": rule})

    if path.is_symlink():
        add("symlink-outside-clean-source")
        return findings
    if not path.is_file():
        return findings
    if ((path.name == ".env" or path.name.startswith(".env.") or path.name.endswith(".env"))
            and path.name != ".env.example"):
        add("private-environment-file")
    if PRIVATE_FILE.search(path.name) or any(p in {"secrets", "credentials"} for p in path.relative_to(root).parts):
        add("private-credential-file")
    try:
        content = path.read_text(encoding="utf-8")
    except UnicodeDecodeError:
        return findings
    for rule, pattern in PATTERNS.items():
        for match in pattern.finditer(content):
            add(rule, content.count("\n", 0, match.start()) + 1)
    for match in SECRET_ASSIGNMENT.finditer(content):
        if entropy(match.group(2)) >= 3.5:
            add("high-entropy-secret-assignment", content.count("\n", 0, match.start()) + 1)
    if path.name == ".env.example":
        for number, line in enumerate(content.splitlines(), 1):
            if line.lstrip().startswith("#") or "=" not in line:
                continue
            name, value = line.split("=", 1)
            if re.search(r"(?:KEY|TOKEN|SECRET|PASSWORD)$", name.strip()) and value.strip():
                add("nonempty-public-secret-template", number)
    return findings


def candidates(root, all_files=False):
    if not all_files:
        result = subprocess.run(
            ["git", "ls-files", "--cached", "--others", "--exclude-standard", "-z"],
            cwd=root, capture_output=True, check=False,
        )
        if result.returncode == 0:
            return [root / p for p in sorted(set(result.stdout.decode().split("\0"))) if p]
    return [p for p in sorted(root.rglob("*")) if p.is_file()
            and not any(part in LOCAL_DIRECTORIES for part in p.relative_to(root).parts)]


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--all", action="store_true", help="Also inspect generated web bundles.")
    args = parser.parse_args()
    paths = candidates(ROOT, all_files=args.all)
    findings = [finding for path in paths for finding in inspect_file(path, ROOT)]
    print(json.dumps({"status": "failed" if findings else "passed", "filesChecked": len(paths),
                      "findings": findings}, ensure_ascii=False, indent=2))
    return bool(findings)


if __name__ == "__main__":
    raise SystemExit(main())
