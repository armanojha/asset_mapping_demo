"""
Standardized geographic feature classification engine.
Maps source-specific attributes to the canonical internal schema without artificial assumptions.
Adheres strictly to deterministic rule-based mapping (zero AI hallucination).
"""

import hashlib
import logging
import uuid
from typing import Any, Dict, List, Optional, Tuple, Union

import geopandas as gpd
import shapely.geometry

from app.schemas.classification import (
    ClassificationReport,
    ClassificationRuleMatch,
    PrimaryCategory,
    StandardizedFeature,
    StandardizedFeatureCollection,
    StandardizedFeatureMetadata,
)

logger = logging.getLogger("preprocessing.classifier")


# Institutional keywords for community asset attribute inspection
COMMUNITY_ASSET_KEYWORDS: Dict[str, Tuple[PrimaryCategory, str]] = {
    # Healthcare
    "hospital": (PrimaryCategory.COMMUNITY_ASSETS, "healthcare"),
    "swasthya": (PrimaryCategory.COMMUNITY_ASSETS, "healthcare"),
    "dispensary": (PrimaryCategory.COMMUNITY_ASSETS, "healthcare"),
    "clinic": (PrimaryCategory.COMMUNITY_ASSETS, "healthcare"),
    "phc": (PrimaryCategory.COMMUNITY_ASSETS, "healthcare"),
    "chc": (PrimaryCategory.COMMUNITY_ASSETS, "healthcare"),
    "health": (PrimaryCategory.COMMUNITY_ASSETS, "healthcare"),
    # Education
    "school": (PrimaryCategory.COMMUNITY_ASSETS, "school"),
    "vidyalaya": (PrimaryCategory.COMMUNITY_ASSETS, "school"),
    "shala": (PrimaryCategory.COMMUNITY_ASSETS, "school"),
    "college": (PrimaryCategory.COMMUNITY_ASSETS, "school"),
    "anganwadi": (PrimaryCategory.COMMUNITY_ASSETS, "school"),
    "prathmik": (PrimaryCategory.COMMUNITY_ASSETS, "school"),
    # Governance / Civic
    "panchayat": (PrimaryCategory.COMMUNITY_ASSETS, "panchayat_office"),
    "bhawan": (PrimaryCategory.COMMUNITY_ASSETS, "community_hall"),
    "community centre": (PrimaryCategory.COMMUNITY_ASSETS, "community_hall"),
    "samudayik": (PrimaryCategory.COMMUNITY_ASSETS, "community_hall"),
    "post office": (PrimaryCategory.COMMUNITY_ASSETS, "post_office"),
    "police": (PrimaryCategory.COMMUNITY_ASSETS, "police_station"),
    # Religious
    "mandir": (PrimaryCategory.COMMUNITY_ASSETS, "religious_place"),
    "temple": (PrimaryCategory.COMMUNITY_ASSETS, "religious_place"),
    "masjid": (PrimaryCategory.COMMUNITY_ASSETS, "religious_place"),
    "mosque": (PrimaryCategory.COMMUNITY_ASSETS, "religious_place"),
    "church": (PrimaryCategory.COMMUNITY_ASSETS, "religious_place"),
    "gurudwara": (PrimaryCategory.COMMUNITY_ASSETS, "religious_place"),
    "dargah": (PrimaryCategory.COMMUNITY_ASSETS, "religious_place"),
    # Water point
    "drinking water": (PrimaryCategory.COMMUNITY_ASSETS, "drinking_water_point"),
    "water tank": (PrimaryCategory.COMMUNITY_ASSETS, "water_facility"),
    "jal": (PrimaryCategory.COMMUNITY_ASSETS, "water_facility"),
}


class FeatureClassifier:
    """
    Modular, deterministic classification engine.
    Converts heterogeneous source features into canonical standardized features.
    """

    def __init__(self, default_crs: str = "EPSG:4326"):
        self.default_crs = default_crs

    @staticmethod
    def _generate_feature_id(
        source_name: str,
        source_layer: Optional[str],
        source_id: Optional[Union[str, int]],
        feature_index: int,
    ) -> str:
        """Generates a stable, unique internal feature ID preserving source lineage."""
        src_clean = source_name.lower().replace(" ", "_")
        layer_clean = (source_layer or "unknown").lower().replace(" ", "_")
        id_str = str(source_id) if source_id is not None else f"idx_{feature_index}"
        # Deterministic UUID5 based on namespace, source composite, and feature row index
        raw_key = f"{src_clean}::{layer_clean}::{id_str}::{feature_index}"
        deterministic_uuid = str(uuid.uuid5(uuid.NAMESPACE_DNS, raw_key))
        return f"feat_{deterministic_uuid[:12]}"

    def _inspect_institutional_attributes(
        self, properties: Dict[str, Any]
    ) -> Optional[Tuple[PrimaryCategory, str, str]]:
        """
        Inspects text attributes (name, remarks, adl_info, area_desc) for institutional
        community asset keywords. Returns (Category, subcategory, matched_word) if verified.
        """
        candidate_fields = ["name", "remarks", "adl_info", "area_desc", "description", "amenity"]
        for field in candidate_fields:
            val = properties.get(field)
            if val is not None and not (isinstance(val, float) and val != val):  # Not NaN
                text = str(val).lower()
                for kw, (cat, subcat) in COMMUNITY_ASSET_KEYWORDS.items():
                    if kw in text:
                        return cat, subcat, f"{field} contains '{kw}'"
        return None

    def classify_grammanchitra(
        self,
        properties: Dict[str, Any],
        source_layer: Optional[str],
    ) -> ClassificationRuleMatch:
        """Rule-based classifier for Gram Manchitra / Survey of India SVAMITVA datasets."""
        layer_str = (source_layer or "").lower()

        # Step 1: Check for explicitly supported community assets first (schools, hospitals, etc.)
        inst_match = self._inspect_institutional_attributes(properties)
        if inst_match:
            cat, subcat, reason = inst_match
            return ClassificationRuleMatch(
                field_matched=reason,
                value_matched=properties.get("name") or properties.get("remarks"),
                match_type="institutional_attribute_match",
                target_category=cat,
                target_subcategory=subcat,
            )

        # Step 2: Specific attribute matching
        pavement = properties.get("pavement")
        if pavement is not None and not (isinstance(pavement, float) and pavement != pavement):
            pave_str = str(pavement).upper()
            if "PAVED" in pave_str:
                return ClassificationRuleMatch(
                    field_matched="pavement",
                    value_matched=pavement,
                    match_type="exact",
                    target_category=PrimaryCategory.ROADS,
                    target_subcategory="paved_road",
                )
            elif "UNPAVED" in pave_str:
                return ClassificationRuleMatch(
                    field_matched="pavement",
                    value_matched=pavement,
                    match_type="exact",
                    target_category=PrimaryCategory.ROADS,
                    target_subcategory="unpaved_road",
                )

        road_type = properties.get("road_type")
        if road_type is not None and not (isinstance(road_type, float) and road_type != road_type):
            return ClassificationRuleMatch(
                field_matched="road_type",
                value_matched=road_type,
                match_type="exact",
                target_category=PrimaryCategory.ROADS,
                target_subcategory="village_road",
            )

        b_type = properties.get("built_up_area_type")
        if b_type is not None and not (isinstance(b_type, float) and b_type != b_type):
            return ClassificationRuleMatch(
                field_matched="built_up_area_type",
                value_matched=b_type,
                match_type="exact",
                target_category=PrimaryCategory.BUILDINGS,
                target_subcategory="abadi_building",
            )

        parcel_type = properties.get("parcel_type")
        if parcel_type is not None and not (isinstance(parcel_type, float) and parcel_type != parcel_type):
            pt_lower = str(parcel_type).lower()
            if "property" in pt_lower or "abadi" in pt_lower:
                return ClassificationRuleMatch(
                    field_matched="parcel_type",
                    value_matched=parcel_type,
                    match_type="case_insensitive",
                    target_category=PrimaryCategory.LAND_PARCELS,
                    target_subcategory="property_parcel",
                )
            elif "agri" in pt_lower or "khasra" in pt_lower or "krishi" in pt_lower:
                return ClassificationRuleMatch(
                    field_matched="parcel_type",
                    value_matched=parcel_type,
                    match_type="case_insensitive",
                    target_category=PrimaryCategory.AGRICULTURAL_LAND,
                    target_subcategory="cropland",
                )

        prop_type = properties.get("property_type")
        if prop_type is not None and not (isinstance(prop_type, float) and prop_type != prop_type):
            return ClassificationRuleMatch(
                field_matched="property_type",
                value_matched=prop_type,
                match_type="exact",
                target_category=PrimaryCategory.LAND_PARCELS,
                target_subcategory="property_parcel",
            )

        # Step 3: Source Layer-level Fallbacks
        if "layer_0" in layer_str or "road" in layer_str:
            return ClassificationRuleMatch(
                field_matched="source_layer",
                value_matched=source_layer,
                match_type="layer_fallback",
                target_category=PrimaryCategory.ROADS,
                target_subcategory="generic",
            )
        elif "layer_1" in layer_str or "built_up" in layer_str or "building" in layer_str:
            return ClassificationRuleMatch(
                field_matched="source_layer",
                value_matched=source_layer,
                match_type="layer_fallback",
                target_category=PrimaryCategory.BUILDINGS,
                target_subcategory="generic",
            )
        elif "layer_2" in layer_str or "parcel" in layer_str:
            return ClassificationRuleMatch(
                field_matched="source_layer",
                value_matched=source_layer,
                match_type="layer_fallback",
                target_category=PrimaryCategory.LAND_PARCELS,
                target_subcategory="generic",
            )
        elif "water" in layer_str or "tank" in layer_str or "pond" in layer_str:
            return ClassificationRuleMatch(
                field_matched="source_layer",
                value_matched=source_layer,
                match_type="layer_fallback",
                target_category=PrimaryCategory.WATER_BODIES,
                target_subcategory="pond_tank",
            )
        elif "boundary" in layer_str:
            return ClassificationRuleMatch(
                field_matched="source_layer",
                value_matched=source_layer,
                match_type="layer_fallback",
                target_category=PrimaryCategory.ADMINISTRATIVE_BOUNDARIES,
                target_subcategory="village_boundary",
            )

        # Step 4: Fallback to OTHER
        return ClassificationRuleMatch(
            field_matched=None,
            value_matched=None,
            match_type="fallback_other",
            target_category=PrimaryCategory.OTHER,
            target_subcategory="unclassified",
        )

    def classify_osm(
        self,
        properties: Dict[str, Any],
        source_layer: Optional[str] = None,
    ) -> ClassificationRuleMatch:
        """Rule-based classifier for OpenStreetMap features."""
        # 1. Check institutional amenity
        amenity = properties.get("amenity")
        if amenity is not None:
            am_lower = str(amenity).lower()
            if am_lower in ["school", "college", "kindergarten"]:
                return ClassificationRuleMatch(
                    field_matched="amenity",
                    value_matched=amenity,
                    match_type="exact",
                    target_category=PrimaryCategory.COMMUNITY_ASSETS,
                    target_subcategory="school",
                )
            elif am_lower in ["hospital", "clinic", "pharmacy", "doctors"]:
                return ClassificationRuleMatch(
                    field_matched="amenity",
                    value_matched=amenity,
                    match_type="exact",
                    target_category=PrimaryCategory.COMMUNITY_ASSETS,
                    target_subcategory="healthcare",
                )
            elif am_lower in ["place_of_worship"]:
                return ClassificationRuleMatch(
                    field_matched="amenity",
                    value_matched=amenity,
                    match_type="exact",
                    target_category=PrimaryCategory.COMMUNITY_ASSETS,
                    target_subcategory="religious_place",
                )
            elif am_lower in ["community_centre", "townhall"]:
                return ClassificationRuleMatch(
                    field_matched="amenity",
                    value_matched=amenity,
                    match_type="exact",
                    target_category=PrimaryCategory.COMMUNITY_ASSETS,
                    target_subcategory="community_hall",
                )

        # 2. Check highway
        highway = properties.get("highway")
        if highway is not None:
            hw_lower = str(highway).lower()
            if hw_lower in ["primary", "secondary", "tertiary", "trunk"]:
                sub = "highway"
            elif hw_lower in ["residential", "living_street", "unclassified"]:
                sub = "village_road"
            elif hw_lower in ["track", "path", "footway"]:
                sub = "path_track"
            else:
                sub = "generic"
            return ClassificationRuleMatch(
                field_matched="highway",
                value_matched=highway,
                match_type="exact",
                target_category=PrimaryCategory.ROADS,
                target_subcategory=sub,
            )

        # 3. Check building
        building = properties.get("building")
        if building is not None and str(building).lower() not in ["no", "false", "0"]:
            b_lower = str(building).lower()
            if b_lower in ["residential", "house", "apartments"]:
                sub = "residential"
            elif b_lower in ["commercial", "retail"]:
                sub = "commercial"
            elif b_lower == "school":
                return ClassificationRuleMatch(
                    field_matched="building",
                    value_matched=building,
                    match_type="exact",
                    target_category=PrimaryCategory.COMMUNITY_ASSETS,
                    target_subcategory="school",
                )
            elif b_lower == "hospital":
                return ClassificationRuleMatch(
                    field_matched="building",
                    value_matched=building,
                    match_type="exact",
                    target_category=PrimaryCategory.COMMUNITY_ASSETS,
                    target_subcategory="healthcare",
                )
            else:
                sub = "generic"
            return ClassificationRuleMatch(
                field_matched="building",
                value_matched=building,
                match_type="exact",
                target_category=PrimaryCategory.BUILDINGS,
                target_subcategory=sub,
            )

        # 4. Check waterway or natural=water
        waterway = properties.get("waterway")
        if waterway is not None:
            return ClassificationRuleMatch(
                field_matched="waterway",
                value_matched=waterway,
                match_type="exact",
                target_category=PrimaryCategory.WATER_BODIES,
                target_subcategory="river_stream",
            )
        natural = properties.get("natural")
        if natural is not None:
            nat_lower = str(natural).lower()
            if nat_lower in ["water", "wetland"]:
                return ClassificationRuleMatch(
                    field_matched="natural",
                    value_matched=natural,
                    match_type="exact",
                    target_category=PrimaryCategory.WATER_BODIES,
                    target_subcategory="pond_tank",
                )
            elif nat_lower in ["wood", "tree", "scrub", "grassland"]:
                return ClassificationRuleMatch(
                    field_matched="natural",
                    value_matched=natural,
                    match_type="exact",
                    target_category=PrimaryCategory.VEGETATION,
                    target_subcategory=nat_lower,
                )

        # 5. Check landuse
        landuse = properties.get("landuse")
        if landuse is not None:
            lu_lower = str(landuse).lower()
            if lu_lower in ["farmland", "orchard", "meadow", "farmyard"]:
                return ClassificationRuleMatch(
                    field_matched="landuse",
                    value_matched=landuse,
                    match_type="exact",
                    target_category=PrimaryCategory.AGRICULTURAL_LAND,
                    target_subcategory="cropland",
                )
            elif lu_lower in ["forest"]:
                return ClassificationRuleMatch(
                    field_matched="landuse",
                    value_matched=landuse,
                    match_type="exact",
                    target_category=PrimaryCategory.VEGETATION,
                    target_subcategory="forest",
                )
            elif lu_lower in ["reservoir", "basin"]:
                return ClassificationRuleMatch(
                    field_matched="landuse",
                    value_matched=landuse,
                    match_type="exact",
                    target_category=PrimaryCategory.WATER_BODIES,
                    target_subcategory="reservoir",
                )

        # 6. Check boundary
        boundary = properties.get("boundary")
        if boundary is not None and str(boundary).lower() == "administrative":
            return ClassificationRuleMatch(
                field_matched="boundary",
                value_matched=boundary,
                match_type="exact",
                target_category=PrimaryCategory.ADMINISTRATIVE_BOUNDARIES,
                target_subcategory="administrative_boundary",
            )

        # Fallback
        return ClassificationRuleMatch(
            field_matched=None,
            value_matched=None,
            match_type="fallback_other",
            target_category=PrimaryCategory.OTHER,
            target_subcategory="unclassified",
        )

    def classify_feature(
        self,
        properties: Dict[str, Any],
        geometry_dict: Dict[str, Any],
        source_name: str,
        source_layer: Optional[str] = None,
        source_id: Optional[Union[str, int]] = None,
        feature_index: int = 0,
        original_crs: Optional[str] = None,
    ) -> Tuple[StandardizedFeature, ClassificationRuleMatch]:
        """
        Classifies a single geographic feature and returns a StandardizedFeature
        with full provenance metadata and rule audit record.
        """
        src_lower = source_name.lower()
        if "grammanchitra" in src_lower or "soi" in src_lower or "svamitva" in src_lower:
            rule_match = self.classify_grammanchitra(properties, source_layer)
        elif "osm" in src_lower or "openstreetmap" in src_lower:
            rule_match = self.classify_osm(properties, source_layer)
        else:
            # Generic fallback: try checking for common tags
            rule_match = self.classify_osm(properties, source_layer)
            if rule_match.target_category == PrimaryCategory.OTHER:
                rule_match = self.classify_grammanchitra(properties, source_layer)

        feature_id = self._generate_feature_id(
            source_name=source_name,
            source_layer=source_layer,
            source_id=source_id,
            feature_index=feature_index,
        )

        geom_type = geometry_dict.get("type", "Unknown")

        # Capture raw attributes while isolating sanitized normalized properties
        raw_attrs = {
            k: v for k, v in properties.items()
            if not k.startswith("_") and not (isinstance(v, float) and v != v)  # omit NaNs
        }

        norm_properties: Dict[str, Any] = {
            "source_id": source_id,
            "raw_attributes": raw_attrs,
        }

        # Transfer primary identifiers and descriptive fields to root properties
        for key in ["name", "village_name", "lgd_code", "st_area(shape)", "st_length(shape)", "pavement"]:
            if key in properties and not (isinstance(properties[key], float) and properties[key] != properties[key]):
                norm_properties[key] = properties[key]

        metadata = StandardizedFeatureMetadata(
            original_crs=original_crs or self.default_crs,
            processing_status="classified",
            classification_method=f"rule:{rule_match.match_type}",
            classification_confidence=1.0 if rule_match.match_type != "fallback_other" else 0.2,
            raw_properties_count=len(raw_attrs),
            processing_notes=[
                f"Classified as {rule_match.target_category.value}:{rule_match.target_subcategory or 'none'}",
                f"Rule match: {rule_match.match_type} (field: {rule_match.field_matched})",
            ],
        )

        std_feature = StandardizedFeature(
            feature_id=feature_id,
            source_id=source_id,
            source_name=source_name,
            source_layer=source_layer,
            category=rule_match.target_category,
            subcategory=rule_match.target_subcategory,
            geometry_type=geom_type,
            geometry=geometry_dict,
            properties=norm_properties,
            metadata=metadata,
        )

        return std_feature, rule_match

    def classify_geodataframe(
        self,
        gdf: gpd.GeoDataFrame,
        source_name: str,
        source_layer: Optional[str] = None,
        id_column: Optional[str] = "uniq_id",
        dataset_name: str = "dataset",
    ) -> Tuple[StandardizedFeatureCollection, ClassificationReport]:
        """
        Classifies an entire GeoPandas GeoDataFrame into a StandardizedFeatureCollection
        and generates an unclassified feature and rule match quality report.
        """
        total = len(gdf)
        if total == 0:
            report = ClassificationReport(
                dataset_name=dataset_name,
                source_name=source_name,
                total_features=0,
            )
            return StandardizedFeatureCollection(dataset_name=dataset_name, features=[], total_count=0), report

        crs_str = str(gdf.crs) if gdf.crs is not None else self.default_crs

        # Resolve ID column
        if id_column and id_column in gdf.columns:
            id_series = gdf[id_column]
        elif "objectid" in gdf.columns:
            id_series = gdf["objectid"]
        elif "osm_id" in gdf.columns:
            id_series = gdf["osm_id"]
        else:
            id_series = gdf.index

        features: List[StandardizedFeature] = []
        cat_counts: Dict[str, int] = {}
        subcat_counts: Dict[str, int] = {}
        rule_stats: Dict[str, int] = {}
        unclassified_count = 0
        unclassified_samples: List[Dict[str, Any]] = []

        for idx, (_, row) in enumerate(gdf.iterrows()):
            geom = row.geometry
            if geom is not None and hasattr(geom, "__geo_interface__"):
                geom_dict = geom.__geo_interface__
            else:
                geom_dict = {"type": "GeometryCollection", "geometries": []}

            # Extract properties excluding geometry
            props = row.drop("geometry").to_dict()
            s_id = id_series.iloc[idx]

            std_feat, rule_match = self.classify_feature(
                properties=props,
                geometry_dict=geom_dict,
                source_name=source_name,
                source_layer=source_layer,
                source_id=s_id,
                feature_index=idx,
                original_crs=crs_str,
            )
            features.append(std_feat)

            # Tally metrics
            c_val = std_feat.category.value
            cat_counts[c_val] = cat_counts.get(c_val, 0) + 1

            sub_val = f"{c_val}::{std_feat.subcategory or 'none'}"
            subcat_counts[sub_val] = subcat_counts.get(sub_val, 0) + 1

            r_type = rule_match.match_type
            rule_stats[r_type] = rule_stats.get(r_type, 0) + 1

            if std_feat.category == PrimaryCategory.OTHER:
                unclassified_count += 1
                if len(unclassified_samples) < 5:
                    unclassified_samples.append({
                        "index": idx,
                        "source_id": s_id,
                        "attributes": {k: v for k, v in props.items() if not (isinstance(v, float) and v != v)},
                    })

        collection = StandardizedFeatureCollection(
            dataset_name=dataset_name,
            features=features,
            total_count=total,
        )

        report = ClassificationReport(
            dataset_name=dataset_name,
            source_name=source_name,
            total_features=total,
            category_counts=cat_counts,
            subcategory_counts=subcat_counts,
            unclassified_features_count=unclassified_count,
            unclassified_feature_samples=unclassified_samples,
            rule_match_stats=rule_stats,
        )

        logger.info(
            "Classified %d features for '%s' (%s): categories=%s, unclassified=%d",
            total,
            dataset_name,
            source_name,
            cat_counts,
            unclassified_count,
        )

        return collection, report
