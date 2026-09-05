import re
import unittest
from pathlib import Path


REPO_ROOT = Path(__file__).resolve().parents[1]
WORKFLOW = (REPO_ROOT / ".github" / "workflows" / "deploy.yml").read_text(encoding="utf-8")
COMPOSE = (REPO_ROOT / "docker-compose.yml").read_text(encoding="utf-8")


class DeployContractTests(unittest.TestCase):
    def test_production_workflow_cancels_superseded_runs(self):
        self.assertRegex(WORKFLOW, r"(?m)^concurrency:\s*$")
        self.assertRegex(WORKFLOW, r"(?m)^\s+group:\s*kepstroy-production-")
        self.assertRegex(WORKFLOW, r"(?m)^\s+cancel-in-progress:\s*true\s*$")

    def test_both_images_are_published_with_the_workflow_sha(self):
        self.assertEqual(2, WORKFLOW.count("type=raw,value=${{ github.sha }}"))
        self.assertNotRegex(WORKFLOW, r"type=raw,value=latest")

    def test_compose_requires_one_immutable_release_tag_for_both_images(self):
        required_tag = "${KEPSTROY_IMAGE_TAG:?KEPSTROY_IMAGE_TAG is required}"
        self.assertEqual(2, COMPOSE.count(required_tag))
        self.assertNotRegex(COMPOSE, r"(?m)^\s*image:\s*[^\n]+:latest\s*$")

    def test_deploy_uploads_files_from_the_checked_out_revision(self):
        deploy_job = re.search(r"(?ms)^  deploy:\s.*", WORKFLOW)
        self.assertIsNotNone(deploy_job)
        deploy = deploy_job.group(0)

        self.assertIn("uses: actions/checkout@v4", deploy)
        self.assertIn("uses: appleboy/scp-action@", deploy)
        self.assertRegex(deploy, r"source:\s*[\"']?docker-compose\.yml,nginx\.conf")
        self.assertIn("/tmp/kepstroy-release-${{ github.sha }}", deploy)
        self.assertIn("RELEASE_SHA: ${{ github.sha }}", deploy)
        self.assertIn("KEPSTROY_IMAGE_TAG=${RELEASE_SHA}", deploy)
        self.assertIn('RELEASE_DIR="/tmp/kepstroy-release-${RELEASE_SHA}"', deploy)
        self.assertIn('"$RELEASE_DIR/docker-compose.yml"', deploy)
        self.assertIn('"$RELEASE_DIR/nginx.conf"', deploy)
        self.assertNotRegex(deploy, r"\bgit\s+(?:clone|fetch|pull)\b")

    def test_smoke_checks_do_not_submit_a_real_lead(self):
        self.assertNotIn("CI Test", WORKFLOW)
        self.assertNotIn("/submit", WORKFLOW)
        self.assertNotRegex(WORKFLOW, r"(?m)^\s*-X\s+POST\b")
        self.assertNotIn("--data-urlencode", WORKFLOW)

    def test_smoke_checks_health_pages_and_telegram_read_only(self):
        self.assertIn("http://localhost:3000/health", WORKFLOW)
        self.assertIn("https://kepstroy.ru/", WORKFLOW)
        self.assertIn("https://kepstroy.ru/uslugi/generatory/", WORKFLOW)
        self.assertIn("/getMe", WORKFLOW)


if __name__ == "__main__":
    unittest.main()
