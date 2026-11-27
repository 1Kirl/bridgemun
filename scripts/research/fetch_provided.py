import re, html, json, os, sys, urllib.request
# Downloads the provided research materials (read-only; nothing is changed at the source) into
# .data/research/raw (git-ignored). Run from the repository root:  python3 scripts/research/fetch_provided.py
# Only items shared as "anyone with the link" can be fetched; sharing settings are never changed.
OUT = os.path.join(os.getcwd(), ".data/research/raw/drive")
DOCS = ["1iEqPF5hh4NgNXUwY-eTCEPkLrodVhjaabaF2cBfPK5M", "1fcZKOVfM31-O84ndJIkYLhCXTbRsA_Mnc6pkgduQiCk", "1w0ZLFRufCkYhghRdE3FZzwUHL7Q9cpWWVcWM9oqEfik"]
os.makedirs(OUT, exist_ok=True)
def get(url):
    req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
    with urllib.request.urlopen(req, timeout=60) as r:
        return r.status, r.read()
manifest = []
def walk(fid, path):
    st, b = get(f"https://drive.google.com/embeddedfolderview?id={fid}#list")
    s = b.decode("utf8", "replace")
    entries = [(html.unescape(m.group(2)), m.group(1)) for m in re.finditer(r'<a href="([^"]+)"[^>]*>.*?<div class="flip-entry-title">(.*?)</div>', s, re.S)]
    for name, url in entries:
        p = f"{path}/{name}"
        m = re.search(r"/folders/([\w-]+)", url)
        if m:
            manifest.append({"path": p, "kind": "folder", "id": m.group(1), "url": url})
            walk(m.group(1), p)
            continue
        m = re.search(r"/document/d/([\w-]+)", url)
        if m:
            did = m.group(1); dest = f"{OUT}{p}.txt"
            os.makedirs(os.path.dirname(dest), exist_ok=True)
            try:
                st, data = get(f"https://docs.google.com/document/d/{did}/export?format=txt")
                open(dest, "wb").write(data); manifest.append({"path": p, "kind": "gdoc", "id": did, "url": url, "status": st, "bytes": len(data)})
            except Exception as e:
                manifest.append({"path": p, "kind": "gdoc", "id": did, "url": url, "error": str(e)})
            continue
        m = re.search(r"/file/d/([\w-]+)", url)
        if m:
            did = m.group(1); dest = f"{OUT}{p}"
            os.makedirs(os.path.dirname(dest), exist_ok=True)
            try:
                st, data = get(f"https://drive.google.com/uc?export=download&id={did}")
                if data[:15].lower().startswith(b"<!doctype html") or b"Google Drive - Virus scan warning" in data[:3000]:
                    m2 = re.search(rb'name="uuid" value="([^"]+)"', data)
                    st, data = get(f"https://drive.usercontent.google.com/download?id={did}&export=download&confirm=t" + (f"&uuid={m2.group(1).decode()}" if m2 else ""))
                open(dest, "wb").write(data); manifest.append({"path": p, "kind": "file", "id": did, "url": url, "status": st, "bytes": len(data)})
            except Exception as e:
                manifest.append({"path": p, "kind": "file", "id": did, "url": url, "error": str(e)})
            continue
        manifest.append({"path": p, "kind": "unknown", "url": url})
os.makedirs(os.path.dirname(OUT) + "/docs", exist_ok=True)
for did in DOCS:
    st, data = get(f"https://docs.google.com/document/d/{did}/export?format=txt")
    open(f"{os.path.dirname(OUT)}/docs/{did}.txt", "wb").write(data)
    manifest.append({"path": f"/docs/{did}", "kind": "gdoc", "id": did, "url": f"https://docs.google.com/document/d/{did}/edit", "status": st, "bytes": len(data)})
for fid, label in [("1VPLA8CqBzM_OGcRjPi-nlzO0kUOnQbp4", "/folderA"), ("1cYJZMQ-fNo_Ty9QTlDfBLlyI1_rudVwn", "/folderB")]:
    manifest.append({"path": label, "kind": "folder", "id": fid})
    walk(fid, label)
json.dump(manifest, open(os.path.dirname(OUT) + "/manifest.json", "w"), indent=1, ensure_ascii=False)
for m in manifest: print(m["kind"], m["path"], m.get("bytes", ""), m.get("error", ""))
