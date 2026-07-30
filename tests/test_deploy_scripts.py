from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]


def read_script(path: str) -> str:
    return (ROOT / path).read_text()


def test_backend_and_web_deploys_prepare_zero_traffic_by_default():
    backend = read_script("scripts/deploy-backend.sh")
    web = read_script("scripts/deploy-web.sh")
    common = read_script("scripts/deploy-common.sh")

    assert '--no-traffic' in backend
    assert '--no-traffic' in web
    assert 'PROMOTE="${PROMOTE:-0}"' in common
    assert 'if [[ "$PROMOTE" != "1" ]]' in common
    assert 'promote_revision_if_requested "$BACKEND_SERVICE" "$LATEST_REVISION" "backend"' in backend
    assert 'promote_revision_if_requested "$WEB_SERVICE" "$LATEST_WEB_REVISION" "web"' in web


def test_deploy_common_validates_full_gcloud_target():
    common = read_script("scripts/deploy-common.sh")

    assert "gcloud config configurations list" in common
    assert "gcloud config get-value account" in common
    assert "gcloud config get-value project" in common
    assert "gcloud config get-value run/region" in common
    assert "gcloud config get-value auth/impersonate_service_account" in common
    assert "EXPECTED_IMPERSONATION" in common


def test_critical_target_overrides_require_break_glass():
    common = read_script("scripts/deploy-common.sh")

    assert "BREAK_GLASS_DEPLOY_TARGET" in common
    assert "ensure_expected_deploy_variables" in common
    for variable_name in (
        "PROJECT_ID",
        "REGION",
        "AR_REPO",
        "BACKEND_SERVICE",
        "WEB_SERVICE",
        "SQL_CONNECTION_NAME",
        "GCS_BUCKET",
        "BACKEND_SA",
    ):
        assert f'validate_expected_value {variable_name} "${variable_name}"' in common


def test_cloud_build_substitutions_pin_artifact_registry_repo():
    backend = read_script("scripts/deploy-backend.sh")
    web = read_script("scripts/deploy-web.sh")

    assert '--substitutions="_AR_REPO=${AR_REPO},SHORT_SHA=${IMAGE_TAG}"' in backend
    assert '--substitutions="_AR_REPO=${AR_REPO},_API_BASE_URL=/api,_BACKEND_PROXY_URL=${BACKEND_URL},SHORT_SHA=${IMAGE_TAG}"' in web


def test_production_reminders_require_scheduler_secret():
    common = read_script("scripts/deploy-common.sh")
    backend = read_script("scripts/deploy-backend.sh")
    example_env = read_script(".env.deploy.example")

    assert "require_scheduler_secret_for_reminders" in common
    assert 'require_env_vars INTERNAL_SCHEDULER_SECRET_NAME' in common
    assert "PRODUCTION_REMINDERS_ENABLED='1'" in example_env
    assert 'DEFAULT_PRODUCTION_REMINDERS_ENABLED="1"' in common
    assert "INTERNAL_SCHEDULER_SECRET_NAME=''" in example_env
    assert "require_scheduler_secret_for_reminders" in backend
