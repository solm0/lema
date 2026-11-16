from __future__ import annotations

HF_PACK_REPO_ID = "solm0/nautilus-releases"
HF_PACK_REPO_TYPE = "dataset"

def build_pack_download_url(lang: str, version: str, filename: str) -> str:
    return (
        f"https://huggingface.co/datasets/{HF_PACK_REPO_ID}/resolve/main/"
        f"language-packs/{lang}/{version}/{filename}"
    )


def build_pack(
    lang: str,
    version: str,
    corpus: list[dict[str, object]],
    *,
    hidden: bool = False,
):
    lemma_filename = f"{lang}-v{version}-lemma.zip"
    details = [*corpus]

    if model_details := PACK_MODEL_DETAILS.get(lang):
        details.append({"Models": model_details})

    if size_details := PACK_DOWNLOAD_SIZES.get((lang, version)):
        details.append({"Size": size_details})

    if hidden:
        details.append({"Hidden": "true"})

    return {
        "lang": lang,
        "version": version,
        "tag": f"v{version}",
        "lemma_filename": lemma_filename,
        "lemma_download_url": build_pack_download_url(lang, version, lemma_filename),
        "corpus": details,
    }


# Runtime manifests are the source of truth for language-specific NLP
# dependencies. Pack versions may change frequently, but runtime requirements
# only change when we add a language or swap its underlying toolchain.
RUNTIME_MANIFESTS = {
    "de": {
        "lang": "de",
        "runtime_version": 2,
        "shared_dependencies": [],
        "language_packages": [],
        "resource_packages": [],
        "models": [
            {
                "id": "opennlp-de-ud-gsd",
                "provider": "opennlp",
                "lang": "de",
                "resource_id": "opennlp-model-de",
            }
        ],
    },
    "en": {
        "lang": "en",
        "runtime_version": 2,
        # English now uses the bundled Java OpenNLP sidecar.  Its four model
        # files are installed in the user runtime directory by model_store.
        "shared_dependencies": [],
        "language_packages": [],
        "resource_packages": [],
        "models": [
            {
                "id": "opennlp-en-ud-ewt",
                "provider": "opennlp",
                "lang": "en",
                "resource_id": "opennlp-model-en",
            }
        ],
    },
    "ja": {
        "lang": "ja",
        "runtime_version": 2,
        # Sudachi code is in the bundled Java sidecar; the dictionary is
        # downloaded with the pack and removed with its final uninstall.
        "shared_dependencies": [],
        "language_packages": [],
        "resource_packages": [],
        "models": [
            {
                "id": "sudachi-ja-core",
                "provider": "sudachi",
                "lang": "ja",
                "resource_id": "sudachi-dictionary-ja",
            }
        ],
    },
    "ko": {
        "lang": "ko",
        "runtime_version": 2,
        # Kiwi's Java/JNI binding is bundled with the platform sidecar. Its
        # model is downloaded into user data with the language pack.
        "shared_dependencies": [],
        "language_packages": [],
        "resource_packages": [],
        "models": [
            {
                "id": "kiwi-ko-base",
                "provider": "kiwi",
                "lang": "ko",
                "resource_id": "kiwi-model-ko",
            }
        ],
    },
    "ru": {
        "lang": "ru",
        "runtime_version": 2,
        "shared_dependencies": [],
        "language_packages": [],
        "resource_packages": [],
        "models": [
            {
                "id": "opennlp-ru-ud-gsd",
                "provider": "opennlp",
                "lang": "ru",
                "resource_id": "opennlp-model-ru",
            }
        ],
    },
}


# These user-facing names deliberately cover both app targets. They are kept in
# the pack catalogue so the settings UI does not need a separate platform map.
PACK_MODEL_DETAILS = {
    "de": {
        "Desktop": "Apache OpenNLP 2.5.3 (UD GSD)",
        "Mobile": "Apache OpenNLP 2.5.3 (UD GSD)",
    },
    "en": {
        "Desktop": "Apache OpenNLP 2.5.3 (UD EWT)",
        "Mobile": "Apache OpenNLP 2.5.3 (UD EWT)",
    },
    "ja": {
        "Desktop": "Sudachi 0.7.5 + SudachiDict small (2024-04-09)",
        "Mobile": "Sudachi 0.7.5 + SudachiDict small (2024-04-09)",
    },
    "ko": {
        "Desktop": "Kiwi 0.24.0 base model",
        "Mobile": "Kiwi 0.24.0 base model",
    },
    "ru": {
        "Desktop": "Apache OpenNLP 2.5.3 (UD GSD)",
        "Mobile": "Apache OpenNLP 2.5.3 (UD GSD)",
    },
}


# Fresh-install download sizes, measured 2026-11-16 from the current lemma ZIP
# and each runtime model artifact. They are the same for desktop and mobile at
# present. A model is only downloaded once per language, so reinstallation can
# use less data than this value.
PACK_DOWNLOAD_SIZES = {
    ("de", "1.1.2"): {"Desktop": "46.5 MB", "Mobile": "46.5 MB"},
    ("de", "1.1.0"): {"Desktop": "48.7 MB", "Mobile": "48.7 MB"},
    ("en", "1.1.2"): {"Desktop": "36.5 MB", "Mobile": "36.5 MB"},
    ("en", "1.1.0"): {"Desktop": "37.4 MB", "Mobile": "37.4 MB"},
    ("ja", "1.1.2"): {"Desktop": "116.7 MB", "Mobile": "116.7 MB"},
    ("ja", "1.1.1"): {"Desktop": "119.3 MB", "Mobile": "119.3 MB"},
    ("ja", "1.1.0"): {"Desktop": "118.7 MB", "Mobile": "118.7 MB"},
    ("ko", "1.1.2"): {"Desktop": "141.5 MB", "Mobile": "141.5 MB"},
    ("ko", "1.1.0"): {"Desktop": "142.4 MB", "Mobile": "142.4 MB"},
    ("ru", "1.1.2"): {"Desktop": "49.8 MB", "Mobile": "49.8 MB"},
    ("ru", "1.1.0"): {"Desktop": "51.7 MB", "Mobile": "51.7 MB"},
}


PACK_RELEASES = {
    "ru": [
        build_pack(
            "ru",
            "1.1.2",
            [
                {"Data source": "Leipzig Corpora Collection, University of Leipzig"},
                {"Corpora used": "rus_wikipedia_2021_300K"},
                {"Note": "deleted related words"},
            ],
        ),
        build_pack(
            "ru",
            "1.1.0",
            [
                {"Data source": "Leipzig Corpora Collection, University of Leipzig"},
                {"Corpora used": "rus_wikipedia_2021_300K, rus-ru_web-public_2019_1M"},
            ],
            hidden=True,
        ),
        build_pack(
            "ru",
            "1.0.0",
            [
                {"Data source": "Leipzig Corpora Collection, University of Leipzig"},
                {"Corpora used": "rus_wikipedia_2021_300K, rus-ru_web-public_2019_1M"},
            ],
            hidden=True,
        ),
    ],
    "de": [
        build_pack(
            "de",
            "1.1.2",
            [
                {"Data source": "Leipzig Corpora Collection, University of Leipzig"},
                {"Corpora used": "deu_wikipedia_2021_300K"},
                {"Note": "deleted related words"},
            ],
        ),
        build_pack(
            "de",
            "1.1.0",
            [
                {"Data source": "Leipzig Corpora Collection, University of Leipzig"},
                {"Corpora used": "deu_wikipedia_2021_300K, deu-de_web_2021_1M"},
            ],
            hidden=True,
        ),
        build_pack(
            "de",
            "1.0.0",
            [
                {"Data source": "Leipzig Corpora Collection, University of Leipzig"},
                {"Corpora used": "deu_wikipedia_2021_300K, deu-de_web_2021_1M"},
            ],
            hidden=True,
        ),
    ],
    "en": [
        build_pack(
            "en",
            "1.1.2",
            [
                {"Data source": "Leipzig Corpora Collection, University of Leipzig"},
                {"Corpora used": "eng-simple_wikipedia_2021_300K"},
                {"Note": "deleted related words"},
            ],
        ),
        build_pack(
            "en",
            "1.1.0",
            [
                {"Data source": "Leipzig Corpora Collection, University of Leipzig"},
                {"Corpora used": "eng-simple_wikipedia_2021_300K, eng-uk_web-public_2018_1M"},
            ],
            hidden=True,
        ),
        build_pack(
            "en",
            "1.0.0",
            [
                {"Data source": "Leipzig Corpora Collection, University of Leipzig"},
                {"Corpora used": "eng-simple_wikipedia_2021_300K, eng-uk_web-public_2018_1M"},
            ],
            hidden=True,
        ),
    ],
    "ko": [
        build_pack(
            "ko",
            "1.1.2",
            [
                {"Data source": "Leipzig Corpora Collection, University of Leipzig"},
                {"Corpora used": "kor_wikipedia_2021_300K"},
                {"Note": "deleted related words"},
            ],
        ),
        build_pack(
            "ko",
            "1.1.0",
            [
                {"Data source": "Leipzig Corpora Collection, University of Leipzig"},
                {"Corpora used": "kor_wikipedia_2021_300K, kor-kr_web_2020_1M"},
            ],
            hidden=True,
        ),
        build_pack(
            "ko",
            "1.0.0",
            [
                {"Data source": "Leipzig Corpora Collection, University of Leipzig"},
                {"Corpora used": "kor_wikipedia_2021_300K, kor-kr_web_2020_1M"},
            ],
            hidden=True,
        ),
    ],
    "ja": [
        build_pack(
            "ja",
            "1.1.2",
            [
                {"Data source": "Leipzig Corpora Collection, University of Leipzig"},
                {"Corpora used": "jpn_wikipedia_2021_300K"},
                {"Note": "deleted related words"},
            ],
        ),
        build_pack(
            "ja",
            "1.1.1",
            [
                {"Data source": "Leipzig Corpora Collection, University of Leipzig"},
                {"Corpora used": "jpn_wikipedia_2021_300K, jpn-jp_web_2020_1M"},
            ],
            hidden=True,
        ),
        build_pack(
            "ja",
            "1.1.0",
            [
                {"Data source": "Leipzig Corpora Collection, University of Leipzig"},
                {"Corpora used": "jpn_wikipedia_2021_300K, jpn-jp_web_2020_1M"},
            ],
            hidden=True,
        ),
        build_pack(
            "ja",
            "1.0.0",
            [
                {"Data source": "Leipzig Corpora Collection, University of Leipzig"},
                {"Corpora used": "jpn_wikipedia_2021_300K, jpn-jp_web_2020_1M"},
            ],
            hidden=True,
        ),
    ],
}


PACKS = [
    pack
    for lang in sorted(PACK_RELEASES.keys())
    for pack in PACK_RELEASES[lang]
]


def get_pack_map() -> dict[str, dict]:
    return {lang: releases[0] for lang, releases in PACK_RELEASES.items() if releases}


def get_latest_pack(lang: str) -> dict | None:
    releases = PACK_RELEASES.get(lang, [])
    return releases[0] if releases else None


def get_runtime_manifest(lang: str) -> dict:
    try:
        return RUNTIME_MANIFESTS[lang]
    except KeyError as exc:
        raise KeyError(f"Unknown runtime manifest for language: {lang}") from exc


def get_model_provider(lang: str) -> str:
    manifest = get_runtime_manifest(lang)
    models = manifest.get("models") or []

    if not models:
        raise ValueError(f"Language {lang} does not define any models")

    provider = models[0].get("provider")

    if not provider:
        raise ValueError(f"Language {lang} has a model without provider")

    return provider


def get_shared_dependency_ids(lang: str) -> list[str]:
    manifest = get_runtime_manifest(lang)
    return list(manifest.get("shared_dependencies") or [])


def get_language_package_ids(lang: str) -> list[str]:
    manifest = get_runtime_manifest(lang)
    return list(manifest.get("language_packages") or [])


def get_resource_package_ids(lang: str) -> list[str]:
    manifest = get_runtime_manifest(lang)
    return list(manifest.get("resource_packages") or [])


def get_model_resource_ids(lang: str) -> list[str]:
    manifest = get_runtime_manifest(lang)
    models = manifest.get("models") or []
    resource_ids = []

    for model in models:
        resource_id = model.get("resource_id")
        if resource_id:
            resource_ids.append(resource_id)

    return resource_ids


def get_runtime_resource_plan(lang: str) -> dict[str, list[str]]:
    return {
        "shared_dependencies": get_shared_dependency_ids(lang),
        "language_packages": get_language_package_ids(lang),
        "resource_packages": get_resource_package_ids(lang),
        "model_resources": get_model_resource_ids(lang),
    }


def get_runtime_package_spec(package_name: str) -> dict | None:
    # Language packs no longer install Python NLP dependencies at runtime.
    return None


def list_languages() -> list[str]:
    ordered = []
    seen = set()

    for lang in RUNTIME_MANIFESTS:
        if lang in seen:
            continue
        seen.add(lang)
        ordered.append(lang)

    for lang in PACK_RELEASES:
        if lang in seen:
            continue
        seen.add(lang)
        ordered.append(lang)

    return ordered


def list_runtime_manifests() -> list[dict]:
    return [RUNTIME_MANIFESTS[lang] for lang in list_languages() if lang in RUNTIME_MANIFESTS]
