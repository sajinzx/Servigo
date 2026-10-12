"""M1: symptom triage. Free text -> top 3 services for this vehicle kind.

TF-IDF (words and character n-grams, which survive Tanglish/Hinglish spelling
variation) feeding a multinomial logistic regression. The fine-tuned
DistilBERT / multilingual MiniLM step in the plan is optional and not included.
"""
from __future__ import annotations

import numpy as np
from sklearn.feature_extraction.text import TfidfVectorizer
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import f1_score
from sklearn.pipeline import FeatureUnion, Pipeline

from .. import baselines, catalogue


class TriageModel:
    name = "triage"

    def __init__(self) -> None:
        self.pipeline = Pipeline(
            [
                (
                    "tfidf",
                    FeatureUnion(
                        [
                            ("word", TfidfVectorizer(ngram_range=(1, 2), min_df=1, sublinear_tf=True)),
                            ("char", TfidfVectorizer(analyzer="char_wb", ngram_range=(3, 5), min_df=2, sublinear_tf=True)),
                        ]
                    ),
                ),
                ("clf", LogisticRegression(C=20.0, max_iter=2000)),
            ]
        )
        self.classes_: list[str] = []

    @staticmethod
    def _text(text: str, kind: str) -> str:
        # the vehicle kind is known at booking time and removes half the label space
        return f"{baselines.normalise_text(text)} __{kind}__"

    def fit(self, texts, kinds, codes) -> "TriageModel":
        X = [self._text(t, k) for t, k in zip(texts, kinds)]
        self.pipeline.fit(X, list(codes))
        self.classes_ = list(self.pipeline.named_steps["clf"].classes_)
        return self

    def predict_topk(self, text: str, kind: str, k: int = 3) -> list[tuple[str, float]]:
        proba = self.pipeline.predict_proba([self._text(text, kind)])[0]
        allowed = set(catalogue.codes_for_kind(kind))
        scored = [(c, float(p)) for c, p in zip(self.classes_, proba) if c in allowed]
        total = sum(p for _, p in scored) or 1.0
        scored = [(c, p / total) for c, p in sorted(scored, key=lambda x: -x[1])[:k]]
        return scored

    def evaluate(self, texts, kinds, codes) -> dict[str, float]:
        preds, top3 = [], 0
        for t, k, c in zip(texts, kinds, codes):
            ranked = [x for x, _ in self.predict_topk(t, k, 3)]
            preds.append(ranked[0])
            top3 += c in ranked
        return {
            "macro_f1": float(f1_score(list(codes), preds, average="macro")),
            "top3_accuracy": top3 / max(len(codes), 1),
        }


def evaluate_baseline(texts, kinds, codes) -> dict[str, float]:
    preds, top3 = [], 0
    for t, k, c in zip(texts, kinds, codes):
        ranked = baselines.keyword_triage(t, k, 3)
        preds.append(ranked[0])
        top3 += c in ranked
    return {
        "macro_f1": float(f1_score(list(codes), preds, average="macro")),
        "top3_accuracy": top3 / max(len(codes), 1),
    }
