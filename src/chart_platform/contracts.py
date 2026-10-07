"""Bounded, review-required chart transcription. This is not source verification."""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, FiniteFloat, model_validator


class ChartSeriesDraft(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)
    # A cropped chart can have no printed legend. Keep that missing, for user review.
    name: str = Field(max_length=120)
    values: list[FiniteFloat | None] = Field(min_length=1)


class ChartPresentationDraft(BaseModel):
    model_config = ConfigDict(extra="forbid")
    valueAxis: bool = True
    grid: bool = True
    legend: bool = True
    trendArrow: bool = False


class ChartExtractionDraft(BaseModel):
    model_config = ConfigDict(extra="forbid")
    title: str = Field(max_length=240)
    kind: Literal["bar", "grouped-bar", "stacked-bar", "line"]
    unit: str = Field(max_length=80)
    labels: list[str] = Field(min_length=1)
    series: list[ChartSeriesDraft] = Field(min_length=1)
    warnings: list[str] = Field(default_factory=list, max_length=25)
    annotations: list[str] = Field(default_factory=list, max_length=20)
    presentation: ChartPresentationDraft = Field(default_factory=ChartPresentationDraft)

    @model_validator(mode="after")
    def validate_dimensions(self):
        if any(len(label) > 120 for label in self.labels):
            raise ValueError("Category label too long")
        if any(len(item.values) != len(self.labels) for item in self.series):
            raise ValueError("Every series must have exactly one value per category")
        if any(len(warning) > 600 for warning in self.warnings):
            raise ValueError("Warning too long")
        if any(len(note) > 600 for note in self.annotations):
            raise ValueError("Annotation too long")
        if any(value is not None and abs(value) > 1e15 for series in self.series for value in series.values):
            raise ValueError("Value exceeds the supported chart range")
        if self.kind == "bar" and len(self.series) > 1:
            raise ValueError("Multiple series require grouped or stacked bars")
        return self
