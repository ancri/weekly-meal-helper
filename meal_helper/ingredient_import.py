from __future__ import annotations

import re
from collections import Counter, defaultdict
from dataclasses import dataclass
from datetime import date
from typing import Iterable

from .workbook import HistoricalOrderItem


@dataclass(frozen=True)
class IngredientDefinition:
    name: str
    default_unit: str
    patterns: tuple[str, ...]


@dataclass(frozen=True)
class IngredientCandidate:
    name: str
    default_unit: str
    order_weeks: int
    whole_foods_weeks: int
    elsewhere_weeks: int
    whole_foods: bool
    source_confidence: float
    examples: tuple[str, ...]


@dataclass(frozen=True)
class UnmatchedOrderText:
    raw_text: str
    order_weeks: int
    whole_foods_weeks: int
    elsewhere_weeks: int


def _definition(name: str, unit: str, *patterns: str) -> IngredientDefinition:
    return IngredientDefinition(name, unit, patterns)


# These rules intentionally favor common cooking ingredients over snacks,
# beverages, household supplies, and one-off prepared foods in the order sheets.
INGREDIENT_DEFINITIONS = (
    _definition("Eggs", "pieces", r"\beggs?\b(?!\s+noodles?)"),
    _definition(
        "Chicken thighs",
        "lbs",
        r"\bchicken thighs?\b",
        r"\bboneless skinless thighs?\b",
    ),
    _definition("Chicken drumsticks", "lbs", r"\b(?:chicken )?drumsticks?\b"),
    _definition("Chicken", "lbs", r"^chicken$"),
    _definition("Chicken breasts", "lbs", r"\bchicken breasts?\b", r"\bbreasts?\b"),
    _definition("Ground chicken", "lbs", r"\bground chicken\b"),
    _definition("Ground turkey", "lbs", r"\bground turkey\b"),
    _definition("Ground beef", "lbs", r"\bground beef\b"),
    _definition("Beef stew meat", "lbs", r"\bbeef stew meat\b", r"\bbeef brisket\b"),
    _definition("Sukiyaki beef", "lbs", r"\bsukiyaki beef\b", r"\bsliced beef\b"),
    _definition("Italian sausage", "lbs", r"\bitalian sausages?\b"),
    _definition("Sausage", "lbs", r"(?<!italian )\bsausages?\b"),
    _definition("Salmon", "lbs", r"\bsalmon\b"),
    _definition("White fish", "lbs", r"\bwhite fish\b"),
    _definition("Firm tofu", "packages", r"\b(?:extra[ -]?)?firm tofu(?:s)?\b"),
    _definition("Dried tofu", "packages", r"\bdried (?:five spice )?tofu\b"),
    _definition("Tofu", "packages", r"(?<!dried )(?<!firm )\btofu(?:s)?\b"),
    _definition("Bean curd sheets", "packages", r"\bbean curd sheets?\b", r"\btofu sheets?\b"),
    _definition("Paneer", "oz", r"\bpaneer\b"),
    _definition("Broccoli", "heads", r"\bbroccoli\b"),
    _definition("Cauliflower", "heads", r"\bcauliflower\b"),
    _definition("Spinach", "oz", r"\bspinach\b"),
    _definition("Kale", "oz", r"\bkale\b"),
    _definition("Swiss chard", "bunches", r"\b(?:swiss )?chard\b"),
    _definition("Arugula", "oz", r"\barugula\b"),
    _definition("Cabbage", "heads", r"(?<!napa )\bcabbage\b"),
    _definition("Napa cabbage", "heads", r"\bnapa(?: cabbage)?\b"),
    _definition("Brussels sprouts", "lbs", r"\bbrussel(?:s)? sprouts?\b", r"\bbrussels\b"),
    _definition("Carrots", "pieces", r"\bcarrots?\b"),
    _definition("Celery", "stalks", r"\bcelery\b"),
    _definition("Mushrooms", "oz", r"\bcremini\b", r"(?<!shiitake )\bmushrooms?\b"),
    _definition("Shiitake mushrooms", "oz", r"\bshiitake(?: mushrooms?)?\b"),
    _definition("Eggplant", "pieces", r"\b(?:japanese )?eggplants?\b"),
    _definition("Zucchini", "pieces", r"\bzucchinis?\b"),
    _definition("Asparagus", "bunches", r"\basparagus\b"),
    _definition("Bell peppers", "pieces", r"\bbell peppers?\b"),
    _definition("Cherry tomatoes", "oz", r"\bcherry tomatoes?\b"),
    _definition(
        "Tomatoes",
        "pieces",
        r"(?<!cherry )(?<!crushed )(?<!diced )(?<!canned )(?<!sun dried )\btomato(?:es)?\b",
    ),
    _definition("Red onions", "pieces", r"\bred onions?\b"),
    _definition("Onions", "pieces", r"(?<!red )(?<!green )(?<!spring )\bonions?\b"),
    _definition("Scallions", "bunches", r"\bscallions?\b", r"\bspring onions?\b", r"\bgreen onions?\b"),
    _definition("Garlic", "cloves", r"\bgarlic\b"),
    _definition("Ginger", "tbsp", r"\bginger\b(?!\s+(?:ale|beer))"),
    _definition("Fennel", "pieces", r"\bfennel\b"),
    _definition("Potatoes", "lbs", r"(?<!sweet )\bpotato(?:es)?\b"),
    _definition("Sweet potatoes", "lbs", r"\bsweet potato(?:es)?\b"),
    _definition("Butternut squash", "pieces", r"\bbutternut squash\b"),
    _definition("Delicata squash", "pieces", r"\bdelicata(?: squash)?\b"),
    _definition("Green beans", "lbs", r"\bgreen beans?\b"),
    _definition("Peas", "cups", r"\bpeas\b"),
    _definition("Corn", "cups", r"\bcorn\b(?!\s+starch)"),
    _definition("Avocados", "pieces", r"\bavocados?\b(?!\s+oil)"),
    _definition("Lemons", "pieces", r"\blemons?\b"),
    _definition("Limes", "pieces", r"\blimes?\b"),
    _definition("Cilantro", "bunches", r"\bcilantro\b"),
    _definition("Parsley", "bunches", r"\bparsley\b"),
    _definition("Basil", "bunches", r"\bbasil\b"),
    _definition("Apples", "pieces", r"\bapples?\b(?!\s+cider)"),
    _definition("Pears", "pieces", r"\bpears?\b"),
    _definition("Peaches", "pieces", r"\bpeach(?:es)?\b"),
    _definition("Bananas", "pieces", r"\bbananas?\b"),
    _definition("Oranges", "pieces", r"\boranges?\b"),
    _definition("Blueberries", "cups", r"\bblueberries\b"),
    _definition("Raspberries", "cups", r"\braspberries\b"),
    _definition("Strawberries", "cups", r"\bstrawberries\b"),
    _definition("Spaghetti", "oz", r"\bspaghetti\b(?!\s+sauce)"),
    _definition("Penne", "oz", r"\bpenne(?: pasta)?\b"),
    _definition("Rigatoni", "oz", r"\brigatoni\b"),
    _definition("Fusilli", "oz", r"\bfusilli?\b", r"\bfusili\b", r"\btwisty pasta\b"),
    _definition("Bow-tie pasta", "oz", r"\bbow[ -]?tie pasta\b"),
    _definition("Macaroni", "oz", r"\bmacaroni\b"),
    _definition("Lasagna noodles", "oz", r"\blasagna noodles?\b"),
    _definition("Vermicelli noodles", "oz", r"\bvermicelli(?: noodles?)?\b"),
    _definition("Rice noodles", "oz", r"\brice noodles?\b"),
    _definition("Egg noodles", "oz", r"\begg noodles?\b"),
    _definition("Udon noodles", "oz", r"\budon(?: noodles?)?\b"),
    _definition("Shandong noodles", "oz", r"\bshandong noodles?\b"),
    _definition("Basmati rice", "cups", r"\bbasmati(?: rice)?\b"),
    _definition("Jasmine rice", "cups", r"\bjasmine rice\b"),
    _definition("Sushi rice", "cups", r"\bsushi(?: rice)?\b"),
    _definition("Brown rice", "cups", r"\bbrown rice\b"),
    _definition("White rice", "cups", r"\bwhite rice\b"),
    _definition("Rice", "cups", r"^rice$"),
    _definition("Couscous", "cups", r"\bcouscous\b"),
    _definition("Quinoa", "cups", r"\bquinoa\b"),
    _definition("Oatmeal", "cups", r"\boatmeal\b"),
    _definition("Lentils", "cups", r"\blentils?\b"),
    _definition("Chickpeas", "cans", r"\bchickpeas?\b", r"\bgarbanzo beans?\b"),
    _definition("Black beans", "cans", r"\bblack beans?\b"),
    _definition("Cannellini beans", "cans", r"\bcannellini beans?\b"),
    _definition("Kidney beans", "cans", r"\bkidney beans?\b"),
    _definition("White beans", "cans", r"\bwhite beans?\b"),
    _definition("Coconut milk", "cans", r"\bcoconut milk\b"),
    _definition("Whole milk", "cups", r"\bwhole milk\b"),
    _definition("Oat milk", "cups", r"\boat milk\b"),
    _definition("Goat milk", "cups", r"\bgoat milk\b"),
    _definition("Soy milk", "cups", r"\bsoy milk\b"),
    _definition(
        "Milk",
        "cups",
        r"(?<!whole )(?<!oat )(?<!goat )(?<!soy )(?<!coconut )(?<!chocolate )\bmilk\b",
    ),
    _definition("Heavy cream", "cups", r"\bheavy cream\b"),
    _definition("Yogurt", "cups", r"\byogurts?\b", r"\bfage\b", r"\bsiggi's\b"),
    _definition("Parmesan", "oz", r"\bparmesan\b"),
    _definition("Mozzarella", "oz", r"\bmozzarella\b"),
    _definition("Ricotta", "oz", r"\bricotta\b"),
    _definition("Cheddar", "oz", r"\bcheddar\b"),
    _definition("Mexican cheese", "oz", r"\bmexican cheese\b"),
    _definition("Salted butter", "tbsp", r"\bsalted butter\b"),
    _definition("Unsalted butter", "tbsp", r"\b(?:unsalted|butter no salt)\b"),
    _definition("Olive oil", "tbsp", r"\bolive oil\b"),
    _definition("Avocado oil", "tbsp", r"\bavocado oil\b"),
    _definition("Canola oil", "tbsp", r"\bcanola(?: oil)?\b"),
    _definition("Sesame oil", "tbsp", r"\bsesame oil\b"),
    _definition("Soy sauce", "tbsp", r"(?<!dark )\bsoy sauce\b"),
    _definition("Dark soy sauce", "tbsp", r"\bdark soy sauce\b"),
    _definition("Mirin", "tbsp", r"\bmirin\b"),
    _definition("Sesame seeds", "tbsp", r"\bsesame seeds?\b(?!\s+oil)"),
    _definition("Fish sauce", "tbsp", r"\bfish sauce\b"),
    _definition("Oyster sauce", "tbsp", r"\boyster sauce\b"),
    _definition("Gochujang", "tbsp", r"\bgochujang\b", r"\bgojuchang\b"),
    _definition("Red curry paste", "tbsp", r"\bred curry(?: paste)?\b"),
    _definition("White miso", "tbsp", r"\bwhite miso\b"),
    _definition("Sriracha", "tbsp", r"\bsriracha\b"),
    _definition("Mayonnaise", "tbsp", r"\bmayo(?:nnaise)?\b"),
    _definition("Mustard", "tbsp", r"\bmustard\b"),
    _definition("Honey", "tbsp", r"\bhoney\b"),
    _definition("Maple syrup", "tbsp", r"\bmaple syrup\b"),
    _definition("Balsamic vinegar", "tbsp", r"\bbalsamic(?: vinegar)?\b"),
    _definition("Pesto", "tbsp", r"\bpesto\b"),
    _definition("Crushed tomatoes", "cans", r"\bcrushed tomatoes?\b"),
    _definition("Diced tomatoes", "cans", r"\bdiced tomatoes?\b"),
    _definition("Canned tomatoes", "cans", r"\bcanned tomatoes?\b"),
    _definition("Tomato sauce", "cans", r"\btomato sauce\b"),
    _definition("Marinara sauce", "jars", r"\bspaghetti sauce\b", r"\bmarinara\b"),
    _definition("Chicken broth", "cups", r"\bchicken broth\b"),
    _definition("Bone broth", "cups", r"\bbone broth\b"),
    _definition("Vegetable broth", "cups", r"\bvegetable (?:broth|stock)\b"),
    _definition("Walnuts", "cups", r"\bwalnuts?\b"),
    _definition("Cashews", "cups", r"\bcashews?\b"),
    _definition("Almonds", "cups", r"\balmonds?\b"),
    _definition("Pecans", "cups", r"\bpecans?\b"),
    _definition("Peanut butter", "tbsp", r"\bpeanut butter\b"),
    _definition("Almond butter", "tbsp", r"\balmond butter\b"),
    _definition("Panko breadcrumbs", "cups", r"\bpanko(?: bread ?crumbs?)?\b"),
    _definition("Breadcrumbs", "cups", r"(?<!panko )\bbread ?crumbs?\b"),
    _definition("Flour", "cups", r"\bflour\b(?!\s+tortillas?)"),
    _definition("Brown sugar", "cups", r"\bbrown sugar\b"),
    _definition("Salt", "tsp", r"(?<!no )(?<!salted )\bsalt\b"),
    _definition("Black pepper", "tsp", r"\bblack pepper\b"),
    _definition("Pepper", "tsp", r"(?<!black )(?<!bell )(?<!red )\bpepper\b"),
    _definition("Red pepper flakes", "tsp", r"\bred pepper flakes?\b"),
    _definition("Paprika", "tsp", r"\bpaprika\b"),
    _definition("Oregano", "tsp", r"\boregano\b"),
    _definition("Thyme", "tsp", r"\bthyme\b"),
    _definition("Italian seasoning", "tsp", r"\bitalian seasoning\b"),
    _definition("Turmeric", "tsp", r"\bturmeric\b"),
    _definition("Cumin", "tsp", r"\bcumin\b"),
    _definition("Coriander", "tsp", r"\bcoriander\b"),
    _definition("Grapes", "cups", r"\bgrapes\b"),
    _definition("Edamame", "cups", r"\bedamame\b"),
    _definition("Pumpkin puree", "cans", r"\bpumpkin puree\b"),
    _definition("Jalapenos", "pieces", r"\bjalape(?:n|ñ)os?\b"),
    _definition("Tortillas", "pieces", r"\btortillas?\b"),
    _definition("Naan", "pieces", r"\bnaan\b"),
    _definition("Hummus", "cups", r"\bhummus\b"),
    _definition("Salad greens", "oz", r"\b(?:salad|mixed) greens\b", r"\bsalad mix\b"),
    _definition("Feta", "oz", r"\bfeta\b"),
    _definition("Dill", "bunches", r"\bdill\b"),
    _definition("Beets", "pieces", r"\bbeets?\b"),
    _definition("Sugar", "cups", r"(?<!brown )\bsugar\b"),
    _definition("Ketchup", "tbsp", r"\bketchup\b"),
    _definition("Salsa", "cups", r"\bsalsa\b", r"\bpico\b"),
    _definition("Seaweed", "packages", r"\bseaweed\b"),
)


def matching_definitions(text: str) -> tuple[IngredientDefinition, ...]:
    normalized = " ".join(text.casefold().split())
    return tuple(
        definition
        for definition in INGREDIENT_DEFINITIONS
        if any(re.search(pattern, normalized) for pattern in definition.patterns)
    )


def build_ingredient_candidates(
    orders: Iterable[HistoricalOrderItem], min_weeks: int = 3
) -> tuple[list[IngredientCandidate], list[UnmatchedOrderText], float]:
    order_list = list(orders)
    definition_by_name = {definition.name: definition for definition in INGREDIENT_DEFINITIONS}
    weeks: dict[str, set[date]] = defaultdict(set)
    whole_foods_weeks: dict[str, set[date]] = defaultdict(set)
    elsewhere_weeks: dict[str, set[date]] = defaultdict(set)
    examples: dict[str, Counter[str]] = defaultdict(Counter)
    unmatched: dict[str, dict[str, object]] = {}
    matched_entries = 0

    for order in order_list:
        definitions = matching_definitions(order.raw_text)
        if definitions:
            matched_entries += 1
            for definition in definitions:
                weeks[definition.name].add(order.week_start)
                source_weeks = whole_foods_weeks if order.whole_foods else elsewhere_weeks
                source_weeks[definition.name].add(order.week_start)
                examples[definition.name][order.raw_text] += 1
            continue

        key = order.raw_text.casefold()
        record = unmatched.setdefault(
            key,
            {
                "raw_text": order.raw_text,
                "weeks": set(),
                "whole_foods_weeks": set(),
                "elsewhere_weeks": set(),
            },
        )
        record["weeks"].add(order.week_start)
        source_key = "whole_foods_weeks" if order.whole_foods else "elsewhere_weeks"
        record[source_key].add(order.week_start)

    candidates = []
    for name, seen_weeks in weeks.items():
        if len(seen_weeks) < min_weeks:
            continue
        whole_foods_count = len(whole_foods_weeks[name])
        elsewhere_count = len(elsewhere_weeks[name])
        source_total = whole_foods_count + elsewhere_count
        whole_foods = whole_foods_count >= elsewhere_count
        confidence = max(whole_foods_count, elsewhere_count) / source_total if source_total else 0
        definition = definition_by_name[name]
        candidates.append(
            IngredientCandidate(
                name=name,
                default_unit=definition.default_unit,
                order_weeks=len(seen_weeks),
                whole_foods_weeks=whole_foods_count,
                elsewhere_weeks=elsewhere_count,
                whole_foods=whole_foods,
                source_confidence=confidence,
                examples=tuple(value for value, _ in examples[name].most_common(3)),
            )
        )
    candidates.sort(key=lambda item: (-item.order_weeks, item.name.casefold()))

    unmatched_items = [
        UnmatchedOrderText(
            raw_text=record["raw_text"],
            order_weeks=len(record["weeks"]),
            whole_foods_weeks=len(record["whole_foods_weeks"]),
            elsewhere_weeks=len(record["elsewhere_weeks"]),
        )
        for record in unmatched.values()
    ]
    unmatched_items.sort(key=lambda item: (-item.order_weeks, item.raw_text.casefold()))
    coverage = matched_entries / len(order_list) if order_list else 0
    return candidates, unmatched_items, coverage
