// Default category tree. Households can edit this in Settings; the edited
// version is stored (and synced) in the "meta" collection under id "categories".
// `prepared: true` marks ready-to-eat food, which doesn't get recipe suggestions.
// `nonFood: true` marks household goods (also no recipe suggestions).
export const DEFAULT_CATEGORIES = [
  { id: 'meats', name: 'Meats', icon: '🥩', subs: ['Poultry', 'Beef', 'Pork', 'Seafood', 'Lamb', 'Deli meats', 'Sausage'] },
  { id: 'veggies', name: 'Veggies', icon: '🥦', subs: ['Leafy greens', 'Root vegetables', 'Onions & garlic', 'Peppers & tomatoes', 'Squash', 'Mushrooms', 'Herbs'] },
  { id: 'fruit', name: 'Fruit', icon: '🍎', subs: ['Berries', 'Citrus', 'Apples & pears', 'Tropical', 'Stone fruit'] },
  { id: 'dairy', name: 'Dairy & eggs', icon: '🧀', subs: ['Milk & cream', 'Cheese', 'Yogurt', 'Eggs', 'Butter'] },
  { id: 'pantry', name: 'Pantry', icon: '🫙', subs: ['Pasta & grains', 'Canned goods', 'Baking', 'Oils & vinegars', 'Spices', 'Sauces & condiments', 'Beans & lentils', 'Breakfast'] },
  { id: 'bakery', name: 'Bakery', icon: '🍞', subs: ['Bread', 'Tortillas & wraps', 'Rolls & buns'] },
  { id: 'frozen', name: 'Frozen', icon: '🧊', subs: ['Vegetables', 'Meals', 'Meat & fish', 'Ice cream'] },
  { id: 'desserts', name: 'Desserts', icon: '🍰', subs: ['Cakes & pies', 'Cookies', 'Candy & chocolate', 'Ice cream'] },
  { id: 'snacks', name: 'Snacks', icon: '🥨', subs: ['Chips & crackers', 'Nuts & seeds', 'Bars'] },
  { id: 'prepared', name: 'Prepared foods', icon: '🍱', prepared: true, subs: ['Leftovers', 'Ready meals', 'Deli salads', 'Soups'] },
  { id: 'drinks', name: 'Drinks', icon: '🧃', subs: ['Coffee & tea', 'Juice', 'Soda & water', 'Beer & wine'] },
  { id: 'household', name: 'Household goods', icon: '🧻', nonFood: true, subs: ['Paper goods', 'Cleaning', 'Laundry', 'Dish & kitchen', 'Trash bags', 'Batteries & bulbs', 'Toiletries', 'Medicine & first aid', 'Pet supplies'] },
  { id: 'other', name: 'Other', icon: '📦', subs: [] }
];
