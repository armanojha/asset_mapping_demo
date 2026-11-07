"""
Unit tests for the Standardized Feature Classification Engine.
Validates exact matching, case-insensitivity, institutional keyword checks,
provenance preservation, missing attributes, and unclassified feature reporting.
"""

import geopandas as gpd
import pytest
from shapely.geometry import Point, Polygon

from app.preprocessing.feature_classifier import FeatureClassifier
from app.schemas.classification import PrimaryCategory


def test_classify_grammanchitra_road():
    """Verify Gram Manchitra road layer classification with pavement attribute."""
    classifier = FeatureClassifier()
    props = {
        "road_type": 9,
        "pavement": "PAVED",
        "lgd_code": "491275",
        "village_name": "GUDWARA",
    }
    geom = {"type": "Polygon", "coordinates": [[[0, 0], [1, 0], [1, 1], [0, 0]]]}

    std_feat, match = classifier.classify_feature(
        properties=props,
        geometry_dict=geom,
        source_name="grammanchitra",
        source_layer="grammanchitra_layer_0",
        source_id=101,
        feature_index=0,
    )

    assert std_feat.category == PrimaryCategory.ROADS
    assert std_feat.subcategory == "paved_road"
    assert match.match_type == "exact"
    assert std_feat.source_id == 101
    assert std_feat.source_name == "grammanchitra"
    assert std_feat.properties["village_name"] == "GUDWARA"
    assert std_feat.properties["raw_attributes"]["pavement"] == "PAVED"
    assert std_feat.metadata.classification_confidence == 1.0


def test_classify_grammanchitra_building_general():
    """
    Verify built_up_area_type=19 is classified as BUILDINGS,
    and NOT falsely classified as a school or hospital without evidence.
    """
    classifier = FeatureClassifier()
    props = {
        "built_up_area_type": 19,
        "name": None,
        "area_desc": None,
        "village_name": "GUDWARA",
    }
    geom = {"type": "Polygon", "coordinates": [[[0, 0], [2, 0], [2, 2], [0, 0]]]}

    std_feat, match = classifier.classify_feature(
        properties=props,
        geometry_dict=geom,
        source_name="grammanchitra",
        source_layer="grammanchitra_layer_1",
        source_id="guid-1234",
        feature_index=1,
    )

    assert std_feat.category == PrimaryCategory.BUILDINGS
    assert std_feat.subcategory == "abadi_building"
    assert "school" not in (std_feat.subcategory or "")
    assert "hospital" not in (std_feat.subcategory or "")


def test_classify_institutional_community_asset_by_name():
    """
    Verify institutional building with 'School' or 'Vidyalaya' in name or adl_info
    is classified as COMMUNITY_ASSETS::school.
    """
    classifier = FeatureClassifier()
    props = {
        "built_up_area_type": 19,
        "name": "Prathmik Shala Gudwara",
        "remarks": "Government Primary School",
    }
    geom = {"type": "Polygon", "coordinates": [[[0, 0], [3, 0], [3, 3], [0, 0]]]}

    std_feat, match = classifier.classify_feature(
        properties=props,
        geometry_dict=geom,
        source_name="grammanchitra",
        source_layer="grammanchitra_layer_1",
        source_id=202,
        feature_index=2,
    )

    assert std_feat.category == PrimaryCategory.COMMUNITY_ASSETS
    assert std_feat.subcategory == "school"
    assert match.match_type == "institutional_attribute_match"


def test_classify_healthcare_facility_keyword():
    """Verify healthcare facility keywords classify as COMMUNITY_ASSETS::healthcare."""
    classifier = FeatureClassifier()
    props = {
        "name": "Gramin Swasthya Kendra",
        "adl_info": "Sub Health Centre",
    }
    geom = {"type": "Point", "coordinates": [79.08, 23.11]}

    std_feat, match = classifier.classify_feature(
        properties=props,
        geometry_dict=geom,
        source_name="grammanchitra",
        source_layer="layer_amenity",
        source_id=303,
    )

    assert std_feat.category == PrimaryCategory.COMMUNITY_ASSETS
    assert std_feat.subcategory == "healthcare"


def test_classify_osm_tags():
    """Verify OSM attributes for roads, waterways, vegetation, and agriculture."""
    classifier = FeatureClassifier()
    geom = {"type": "LineString", "coordinates": [[0, 0], [1, 1]]}

    # Highway
    feat_hw, _ = classifier.classify_feature(
        properties={"highway": "primary"},
        geometry_dict=geom,
        source_name="osm",
        source_id=1,
    )
    assert feat_hw.category == PrimaryCategory.ROADS
    assert feat_hw.subcategory == "highway"

    # Waterway
    feat_wt, _ = classifier.classify_feature(
        properties={"waterway": "river"},
        geometry_dict=geom,
        source_name="osm",
        source_id=2,
    )
    assert feat_wt.category == PrimaryCategory.WATER_BODIES
    assert feat_wt.subcategory == "river_stream"

    # Vegetation
    feat_veg, _ = classifier.classify_feature(
        properties={"natural": "wood"},
        geometry_dict=geom,
        source_name="osm",
        source_id=3,
    )
    assert feat_veg.category == PrimaryCategory.VEGETATION
    assert feat_veg.subcategory == "wood"

    # Agriculture
    feat_agri, _ = classifier.classify_feature(
        properties={"landuse": "farmland"},
        geometry_dict=geom,
        source_name="osm",
        source_id=4,
    )
    assert feat_agri.category == PrimaryCategory.AGRICULTURAL_LAND
    assert feat_agri.subcategory == "cropland"


def test_classify_missing_and_unknown_attributes():
    """Verify missing attributes fallback safely to OTHER without raising exceptions."""
    classifier = FeatureClassifier()
    geom = {"type": "Point", "coordinates": [0, 0]}

    # Empty properties with no known layer
    std_feat, match = classifier.classify_feature(
        properties={},
        geometry_dict=geom,
        source_name="unknown_source",
        source_layer="unrecognized_layer",
        source_id=999,
    )

    assert std_feat.category == PrimaryCategory.OTHER
    assert std_feat.subcategory == "unclassified"
    assert match.match_type == "fallback_other"
    assert std_feat.metadata.classification_confidence == 0.2


def test_classify_geodataframe_and_report():
    """Verify full GeoDataFrame classification, duplicate source ID handling, and quality report."""
    classifier = FeatureClassifier()

    p1 = Polygon([(0, 0), (1, 0), (1, 1), (0, 0)])
    p2 = Polygon([(2, 2), (3, 2), (3, 3), (2, 2)])
    p3 = Point(5, 5)

    gdf = gpd.GeoDataFrame(
        {
            "uniq_id": ["dup_id", "dup_id", "mystery_id"],
            "built_up_area_type": [19, 19, None],
            "unknown_col": ["foo", "bar", "baz"],
            "geometry": [p1, p2, p3],
        },
        crs="EPSG:4326",
    )

    collection, report = classifier.classify_geodataframe(
        gdf=gdf,
        source_name="grammanchitra",
        source_layer="unclassified_survey",
        id_column="uniq_id",
        dataset_name="test_buildings",
    )

    assert collection.total_count == 3
    assert len(collection.features) == 3

    # Check that duplicate source_ids generate unique internal feature_ids
    id0 = collection.features[0].feature_id
    id1 = collection.features[1].feature_id
    assert id0 != id1
    assert collection.features[0].source_id == "dup_id"
    assert collection.features[1].source_id == "dup_id"

    # Category counts
    assert report.total_features == 3
    assert report.category_counts.get("BUILDINGS") == 2
    assert report.category_counts.get("OTHER") == 1
    assert report.unclassified_features_count == 1
    assert len(report.unclassified_feature_samples) == 1
