"""Landing demos stay reproducible from the same SVGs and parameters as the workspace."""

from app.demo_presets import OUTPUT, prepare_presets


def test_prepared_presets_match_current_drawings_and_parameters():
    import json

    demos = prepare_presets()
    assert json.loads(OUTPUT.read_text()) == demos
    assert [demo["name"] for demo in demos] == [
        "3F villa",
        "Terrace Villa",
        "Portal Villa",
        "Gable Villa",
    ]
    for demo in demos:
        assert demo["sample"] is True and demo["backend"] is True
        assert any(c["type"] == "stair" for c in demo["components"])
        assert all(c["backendGeometry"] for c in demo["components"])
        assert all(c["mesh"]["indices"] for c in demo["components"] if not c["opening"])
