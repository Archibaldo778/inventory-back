const recipe = (key, name, ingredients, aliases = []) => ({
  key, name, aliases,
  ingredients: ingredients.map(([ingredientName, amountMl, note = '']) => ({ name: ingredientName, amountMl, note })),
});

export const DEFAULT_COCKTAIL_RECIPES = [
  recipe('agave-spice', 'Agave Spice', [['Tequila', 50], ['Lime', 25], ['Simple Syrup', 20], ['Cucumber', 15], ['Jalapeño Tincture', null, 'To taste']]),
  recipe('arm-in-arm', 'Arm in Arm', [['Vodka', 50], ['Lime', 25], ['Simple Syrup', 20], ['Grapefruit', 20], ['St-Germain', 15], ['Peychaud’s Bitters', 0.5]]),
  recipe('barefoot-in-the-grass', 'Barefoot in the Grass', [['Gin', 45], ['Lemon', 22], ['Simple Syrup', 12], ['Honey Syrup', 7], ['Cucumber', 10], ['Orange Bitters', 0.5]]),
  recipe('bonfire-nights', 'Bonfire Nights', [['Tequila', 40], ['Mezcal', 10], ['Lime', 22], ['Grapefruit', 22], ['Simple Syrup', 18]]),
  recipe('cool-breeze', 'Cool Breeze', [['Vodka', 45], ['Lemon', 30], ['Simple Syrup', 15], ['Elderflower', 9], ['Cucumber', 15]]),
  recipe('early-sunset', 'Early Sunset', [['Vodka', 40], ['Lime', 25], ['Simple Syrup', 25], ['Yuzu', 5], ['Mint', null, 'Squeeze and strain'], ['Hibiscus Float', null, 'Pour over']]),
  recipe('golden-negroni', 'Golden Negroni', [['Gin', 25], ['Dry Vermouth', 25], ['Cocchi Americano', 25], ['Suze', 12.5], ['Water', 12.5]]),
  recipe('maple-old-fashioned', 'Maple Old Fashioned', [['Bourbon', 30], ['Applejack', 30], ['Maple Syrup', 5], ['Cinnamon Syrup', 10], ['Water', 10], ['Bitters', 2]]),
  recipe('passion-is-in-fashion', 'Passion Is in Fashion', [['Tequila', 30], ['Ancho Reyes', 15], ['Lime', 20], ['Triple Sec', 10], ['Agave', 20], ['Passion Fruit', 10]]),
  recipe('pick-me-up', 'Pick Me Up', [['Vodka', 30], ['Kahlúa', 25], ['Cold Brew / Coffee', 40], ['Aquafaba', 9]]),
  recipe('spice-of-life', 'Spice of Life', [['Tequila', 30], ['Ancho Reyes', 20], ['Lime', 20], ['Agave', 20], ['Blood Orange', 20]]),
  recipe('yuzu-dream', 'Yuzu Lychee Dream', [['Vodka', 45], ['Lime', 25], ['Yuzu', 5], ['Lychee', 15], ['Simple Syrup', 20]], ['Yuzu Dream']),
];
