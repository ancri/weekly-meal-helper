# Meal assistant v1

We want to automate certain parts of the family weekly meal flow, to get back some hours of free time.

## Deliverable
The deliverable consists of:
- once a week (day-of-week TBD) propose a set of N meals from which the user chooses 3
- present the list of ingredients that should be ordered for the chosen meals
- (optionally) email the ingredients to be purchased to designated email addresses
- (optionally) add the ingredients to our Whole Foods shopping card (on Amazon)

## Data structure
These are the data primitives / abstractions we should use:
- one table holds ingredients. ingredients have unique names and a boolean column "Whole Foods" which is true if we want to order that item from Whole Foods (via amazon.com, where we order the majority of our food) and false otherwise (e.g. for certain kinds of meat we prefer to get it from our local butcher). ingredients that can be obtained from multiple sources can just be named accordingly e.g. we should have a "chicken from Whole Foods" as one ingredient and "chicken from butcher" as a separate ingredient for disambiguation. We prefer this over extra data complexity.
- one table holds recipes. each row should contain at least the recipe name and recipe category (detailed below) and an optional URL with cooking instructions
- one table holds recipe-ingredients linkage, with each row containing recipe id, ingredient id, quantity (a number) and quantity description (e.g. pieces, lbs, etc.). so for any given recipe we will have multiple rows in the recipe-ingredients table.
- one table holds the history of recipes eaten, and recipes presented. we can backpopulate the "recipes eaten" from history, and for recipes presented we can populate it as we go along. so each row should contain something like recipe id, date, accepted (true/false), postponed (true/false) where each row corresponds to one time the recipe was proposed, and to what happened

We should think of weeks (Monday-Sunday) as the "natural unit" and cadence of the system. New week, new proposal.

## Features
Features of the "pick 3 meals" page:
- if the user clicks on a meal it shows its ingredients, and the user can add / delete ingredients as they see fit. next to the ingredient is a quantity with a drop-down that specifies whether we're talking about pieces, or lbs, or something else. the 'default numeraire' should actually be a field in the ingredients table (each ingredient has a unique default numeraire)
- if the user modifies the ingredients for a recipe, they can save their modification for the future, which will update the recipe in the database accordingly- for each proposed meal the user has the choices: accept, reject, suggest it to me again next week. this implies we need an extra field in the db "suggest_next_time"
- we should have a hardcoded config somewhere (doesn't have to live in a db) where we specify how many meals from each category should be presented as choice. default should be 3 meals from each category
- the user should be able to:
  - add existing recipes to the week's menu
  - create new recipes (which will be saved to the db, and added to the week's menu)
  - evidently, remove recipes from the week's menu
  - for now let's create a function to delete a recipe from a db but not expose it in the UI. we can revisit this if we have too much clutter in the recipe list at a later point.
- once a proposal for a given week has been accepted, it becomes locked (and optionally notices are sent out about what to purchase)
- once notices are implemented, we should send out an email with the following: here is what we are cooking this week. here is what we need to get from Whole Foods. here is what we need to get elsewhere
- optionally, once developed, we should then auto-populate our Whole Foods cart with the required ingredients

## Details
Recipe types:
- soups / stews
- pastas
- oven / roasted (e.g. baked salmon, meatballs)

A history of the meals we've had can be found in the B3-B6 cells of the sheets of meals_history.xlsx file which are named after dates e.g. 7/17/26

## Deployment
We will deploy this as a webserver service running on a cheap EC2 box (git pull and then set it up as a svc controlled via systemctl). The database will be tiny and should live on disk to start. We can potentially set up s3 backup at a later point.
