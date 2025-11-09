# modal_app.py
import os
import subprocess
import time

import modal

# New name just to force a fresh image the first time you run it
app = modal.App("bowtie-diagram-v2")

# Image: minimal Python + Streamlit, plus your entire project at /root/app
image = (
    modal.Image.debian_slim()
    # tiny extra package so Modal definitely rebuilds the image
    .pip_install("streamlit>=1.51.0", "watchdog")
    .add_local_dir(".", "/root/app")  # copies your repo INCLUDING frontend/dist
)


@app.function(
    image=image,
    timeout=600,
    min_containers=1,  # keep one container warm
)
@modal.web_server(8000, startup_timeout=300)
def web():
    """
    Run the Streamlit app inside Modal and expose it on port 8000.
    """
    # Only start Streamlit once per container
    if getattr(web, "_started", False):
        return

    web._started = True

    os.chdir("/root/app")
    print("CWD:", os.getcwd())
    print("Top-level files:", os.listdir("."))

    # Extra logging so we can see that dist exists inside the container
    try:
        print("bowtie_flow_component:", os.listdir("bowtie_flow_component"))
        print(
            "frontend:",
            os.listdir(os.path.join("bowtie_flow_component", "frontend")),
        )
        print(
            "dist:",
            os.listdir(os.path.join("bowtie_flow_component", "frontend", "dist")),
        )
    except Exception as e:
        print("Error listing frontend/dist:", e)

    # IMPORTANT: prod mode -> use built dist assets, not dev server
    os.environ.pop("BOWTIE_DEV", None)

    cmd = [
        "streamlit",
        "run",
        "rf_bowtie_app.py",
        "--server.port",
        "8000",
        "--server.address",
        "0.0.0.0",
        "--server.enableCORS",
        "false",
        "--server.enableXsrfProtection",
        "false",
    ]

    # Start Streamlit; let it own the port Modal is proxying
    subprocess.Popen(cmd)


@app.local_entrypoint()
def main():
    print("Launching Bowtie app on Modal (v2)...")
    url = web.get_web_url()
    print("Bowtie app is available at:")
    print(url)

    # Keep the app running until you Ctrl+C in the terminal
    try:
        while True:
            time.sleep(3600)
    except KeyboardInterrupt:
        print("Shutting down Bowtie app...")
