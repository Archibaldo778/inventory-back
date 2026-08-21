const recipe = (key, name, ingredients, aliases = [], instructions = '') => ({
  key, name, aliases, instructions,
  ingredients: ingredients.map(([ingredientName, amountMl, note = '']) => ({ name: ingredientName, amountMl, note })),
});

export const DEFAULT_COCKTAIL_RECIPES = [
  recipe('agave-spice', 'Agave Spice', [['Tequila', 50], ['Lime', 25], ['Simple Syrup', 20], ['Cucumber', 15], ['Jalapeño Tincture', null, 'To taste']]),
  recipe('arm-in-arm', 'Arm in Arm', [['Vodka', 50], ['Lime', 25], ['Simple Syrup', 20], ['Grapefruit', 20], ['St-Germain', 15], ['Peychaud’s Bitters', 0.5]]),
  recipe('barefoot-in-the-grass', 'Barefoot in the Grass', [['Gin', 45], ['Lemon', 22], ['Simple Syrup', 12], ['Honey Syrup', 7], ['Cucumber', 10], ['Orange Bitters', 0.5]], [], 'Shake well with ice.\nStrain into Nick and Nora glass.\nGarnish with Thyme Sprig (break sprig to be around 4 inches long).'),
  recipe('bonfire-nights', 'Bonfire Nights', [['Tequila', 40], ['Mezcal', 10], ['Lime', 22], ['Grapefruit', 22], ['Simple Syrup', 18]]),
  recipe('cool-breeze', 'Cool Breeze', [['Vodka', 45], ['Lemon', 30], ['Simple Syrup', 15], ['Elderflower', 9], ['Cucumber', 15]], [], 'Shake with ice.\nStrain into Rocks glass.\nTop with a splash of club soda. Stir.\nGarnish with Flower.'),
  recipe('early-sunset', 'Early Sunset', [['Vodka', 40], ['Lime', 25], ['Simple Syrup', 25], ['Yuzu', 5], ['Mint', null, 'Squeeze and strain'], ['Hibiscus Float', null, 'Pour over']]),
  recipe('golden-negroni', 'Golden Negroni', [['Gin', 25], ['Dry Vermouth', 25], ['Cocchi Americano', 25], ['Suze', 12.5], ['Water', 12.5]], [], 'Add mix to shaker.\nStir for 20–30 seconds with ice.\nStrain into Rocks glass.\nSqueeze Lemon Peel over glass.\nGarnish with Lemon Peel.'),
  recipe('maple-old-fashioned', 'Maple Old Fashioned', [['Bourbon', 30], ['Applejack', 30], ['Maple Syrup', 5], ['Cinnamon Syrup', 10], ['Water', 10], ['Bitters', 2]], [], 'Add mix to mixing glass. Stir well with ice (15–20 seconds).\nStrain over fresh ice into Rocks glass.\nGarnish with Blood Orange Slice.'),
  recipe('passion-is-in-fashion', 'Passion Is in Fashion', [['Tequila', 30], ['Ancho Reyes', 15], ['Lime', 20], ['Triple Sec', 10], ['Agave', 20], ['Passion Fruit', 10]], [], 'Shake cocktail with ice.\nStrain over fresh ice in glass.\nGarnish with a Lime Wheel.'),
  recipe('pick-me-up', 'Pick Me Up', [['Vodka', 30], ['Kahlúa', 25], ['Cold Brew / Coffee', 40], ['Aquafaba', 9]], [], 'Shake well with ice.\nStrain into a coupe/martini glass.\nGarnish with 3 Coffee Beans.'),
  recipe('spice-of-life', 'Spice of Life', [['Tequila', 30], ['Ancho Reyes', 20], ['Lime', 20], ['Agave', 20], ['Blood Orange', 20]], [], 'Shake with ice. Strain over fresh ice in a Rocks glass.\nGarnish with a Thyme Sprig and Blood Orange Wheel.'),
  recipe('yuzu-dream', 'Yuzu Lychee Dream', [['Vodka', 45], ['Lime', 25], ['Yuzu', 5], ['Lychee', 15], ['Simple Syrup', 20]], ['Yuzu Dream'], 'Combine ½ mix and ½ Club Soda over ice in a Rocks Glass or Highball.\nStir. Garnish with Mint and Straw.'),
];
