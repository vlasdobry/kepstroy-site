import re
import unittest
from pathlib import Path


REPO_ROOT = Path(__file__).resolve().parents[1]
WORKFLOW = (REPO_ROOT / ".github" / "workflows" / "deploy.yml").read_text(encoding="utf-8")
COMPOSE = (REPO_ROOT / "docker-compose.yml").read_text(encoding="utf-8")


class DeployContractTests(unittest.TestCase):
    @staticmethod
    def workflow_job(name):
        match = re.search(
            rf"(?ms)^  {re.escape(name)}:\s*(.*?)(?=^  [a-zA-Z0-9_-]+:\s*$|\Z)",
            WORKFLOW,
        )
        if match is None:
            raise AssertionError(f"Workflow job is missing: {name}")
        return match.group(1)

    def test_predeploy_jobs_cancel_only_their_own_superseded_work(self):
        workflow_header = WORKFLOW.split("\njobs:", maxsplit=1)[0]
        self.assertNotRegex(workflow_header, r"(?m)^concurrency:\s*$")

        expected_groups = {
            "validate": "kepstroy-validate-${{ github.ref }}",
            "build-site": "kepstroy-build-site-${{ github.ref }}",
            "build-forms": "kepstroy-build-forms-${{ github.ref }}",
        }
        for job_name, group in expected_groups.items():
            with self.subTest(job=job_name):
                job = self.workflow_job(job_name)
                self.assertIn(f"group: {group}", job)
                self.assertRegex(job, r"(?m)^\s{6}cancel-in-progress:\s*true\s*$")

    def test_production_deploy_is_serialized_and_skips_stale_revisions(self):
        deploy = self.workflow_job("deploy")
        self.assertIn("group: kepstroy-production", deploy)
        self.assertRegex(deploy, r"(?m)^\s{6}cancel-in-progress:\s*false\s*$")
        self.assertIn("contents: read", deploy)
        self.assertIn("id: freshness", deploy)
        self.assertIn('gh api "repos/${REPOSITORY}/commits/main" --jq .sha', deploy)
        self.assertIn('if [ "$LATEST_SHA" = "$RELEASE_SHA" ]', deploy)
        self.assertLess(deploy.index("id: freshness"), deploy.index("Checkout release revision"))
        self.assertEqual(3, deploy.count("if: steps.freshness.outputs.current == 'true'"))

    def test_both_images_are_published_with_the_workflow_sha(self):
        self.assertEqual(2, WORKFLOW.count("type=raw,value=${{ github.sha }}"))
        self.assertNotRegex(WORKFLOW, r"type=raw,value=latest")

    def test_compose_requires_one_immutable_release_tag_for_both_images(self):
        required_tag = "${KEPSTROY_IMAGE_TAG:?KEPSTROY_IMAGE_TAG is required}"
        self.assertEqual(2, COMPOSE.count(required_tag))
        self.assertNotRegex(COMPOSE, r"(?m)^\s*image:\s*[^\n]+:latest\s*$")

    def test_deploy_uploads_files_from_the_checked_out_revision(self):
        deploy = self.workflow_job("deploy")

        self.assertIn("uses: actions/checkout@v4", deploy)
        self.assertRegex(deploy, r"source:\s*[\"']?docker-compose\.yml,nginx\.conf")
        self.assertIn("/tmp/kepstroy-release-${{ github.sha }}", deploy)
        self.assertIn("RELEASE_SHA: ${{ github.sha }}", deploy)
        self.assertIn("KEPSTROY_IMAGE_TAG=${RELEASE_SHA}", deploy)
        self.assertIn('RELEASE_DIR="/tmp/kepstroy-release-${RELEASE_SHA}"', deploy)
        self.assertIn('"$RELEASE_DIR/docker-compose.yml"', deploy)
        self.assertIn('"$RELEASE_DIR/nginx.conf"', deploy)
        self.assertNotRegex(deploy, r"\bgit\s+(?:clone|fetch|pull)\b")

    def test_production_ssh_actions_are_pinned_to_reviewed_commits(self):
        deploy = self.workflow_job("deploy")
        self.assertIn(
            "uses: appleboy/scp-action@917f8b81dfc1ccd331fef9e2d61bdc6c8be94634 # v0.1.7",
            deploy,
        )
        self.assertIn(
            "uses: appleboy/ssh-action@029f5b4aeeeb58fdfe1410a5d17f967dacf36262 # v1.0.3",
            deploy,
        )
        self.assertNotRegex(deploy, r"uses:\s*appleboy/(?:scp|ssh)-action@v")

    def test_running_containers_are_verified_against_the_release_sha(self):
        deploy = self.workflow_job("deploy")
        self.assertRegex(
            deploy,
            r"(?m)^\s+EXPECTED_SITE_IMAGE=ghcr\.io/vlasdobry/kepstroy-site:\$\{RELEASE_SHA\}\s*$",
        )
        self.assertRegex(
            deploy,
            r"(?m)^\s+EXPECTED_FORMS_IMAGE=ghcr\.io/vlasdobry/kepstroy-site-forms:\$\{RELEASE_SHA\}\s*$",
        )
        self.assertRegex(
            deploy,
            r"(?m)^\s+if ! ACTUAL_SITE_IMAGE=\$\(sudo docker inspect --format '\{\{\.Config\.Image\}\}' kepstroy-site\); then\s*$",
        )
        self.assertRegex(
            deploy,
            r"(?m)^\s+if ! ACTUAL_FORMS_IMAGE=\$\(sudo docker inspect --format '\{\{\.Config\.Image\}\}' kepstroy-forms\); then\s*$",
        )
        self.assertRegex(
            deploy,
            r'(?m)^\s+if \[ "\$ACTUAL_SITE_IMAGE" != "\$EXPECTED_SITE_IMAGE" \] \|\| \\\s*$',
        )
        self.assertRegex(deploy, r'(?m)^\s+\[ "\$ACTUAL_FORMS_IMAGE" != "\$EXPECTED_FORMS_IMAGE" \]; then\s*$')

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
