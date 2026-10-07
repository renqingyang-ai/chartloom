"""Create a chart from synthetic data using a separately running server."""
import argparse
from chartloom_sdk import ChartloomClient


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--url", default="http://localhost:8907")
    args = parser.parse_args()
    client = ChartloomClient(args.url, client_id="example", theme="neutral")
    job = client.create_chart(
        [{"Month": "Jan", "Revenue": 120.5}, {"Month": "Feb", "Revenue": 145.75}],
        "Compare monthly revenue using bars and show the exact values.",
        file_name="Synthetic monthly revenue",
    )
    result = client.wait(job["id"])
    print("Status:", result["status"])
    print("Editor:", client.editor_url(job["id"]))


if __name__ == "__main__":
    main()
