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
    corpus: list[dict[str, str]],
):
    lemma_filename = f"{lang}-v{version}-lemma.zip"

    return {
        "lang": lang,
        "version": version,
        "tag": f"v{version}",
        "lemma_filename": lemma_filename,
        "lemma_download_url": build_pack_download_url(lang, version, lemma_filename),
        "corpus": corpus,
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


PACK_RELEASES = {
    "ru": [
        build_pack(
            "ru",
            "1.1.2",
            [
                {"Data source": "Leipzig Corpora Collection, University of Leipzig"},
                {"Corpora used": "rus_wikipedia_2021_300K, rus-ru_web-public_2019_1M"},
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
        ),
        build_pack(
            "ru",
            "1.0.0",
            [
                {"Data source": "Leipzig Corpora Collection, University of Leipzig"},
                {"Corpora used": "rus_wikipedia_2021_300K, rus-ru_web-public_2019_1M"},
            ],
        ),
    ],
    "de": [
        build_pack(
            "de",
            "1.1.2",
            [
                {"Data source": "Leipzig Corpora Collection, University of Leipzig"},
                {"Corpora used": "deu_wikipedia_2021_300K, deu-de_web_2021_1M"},
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
        ),
        build_pack(
            "de",
            "1.0.0",
            [
                {"Data source": "Leipzig Corpora Collection, University of Leipzig"},
                {"Corpora used": "deu_wikipedia_2021_300K, deu-de_web_2021_1M"},
            ],
        ),
    ],
    "en": [
        build_pack(
            "en",
            "1.1.2",
            [
                {"Data source": "Leipzig Corpora Collection, University of Leipzig"},
                {"Corpora used": "eng-simple_wikipedia_2021_300K, eng-uk_web-public_2018_1M"},
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
        ),
        build_pack(
            "en",
            "1.0.0",
            [
                {"Data source": "Leipzig Corpora Collection, University of Leipzig"},
                {"Corpora used": "eng-simple_wikipedia_2021_300K, eng-uk_web-public_2018_1M"},
            ],
        ),
    ],
    "ko": [
        build_pack(
            "ko",
            "1.1.2",
            [
                {"Data source": "Leipzig Corpora Collection, University of Leipzig"},
                {"Corpora used": "kor_wikipedia_2021_300K, kor-kr_web_2020_1M"},
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
        ),
        build_pack(
            "ko",
            "1.0.0",
            [
                {"Data source": "Leipzig Corpora Collection, University of Leipzig"},
                {"Corpora used": "kor_wikipedia_2021_300K, kor-kr_web_2020_1M"},
            ],
        ),
    ],
    "ja": [
        build_pack(
            "ja",
            "1.1.2",
            [
                {"Data source": "Leipzig Corpora Collection, University of Leipzig"},
                {"Corpora used": "jpn_wikipedia_2021_300K, jpn-jp_web_2020_1M"},
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
        ),
        build_pack(
            "ja",
            "1.1.0",
            [
                {"Data source": "Leipzig Corpora Collection, University of Leipzig"},
                {"Corpora used": "jpn_wikipedia_2021_300K, jpn-jp_web_2020_1M"},
            ],
        ),
        build_pack(
            "ja",
            "1.0.0",
            [
                {"Data source": "Leipzig Corpora Collection, University of Leipzig"},
                {"Corpora used": "jpn_wikipedia_2021_300K, jpn-jp_web_2020_1M"},
            ],
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
