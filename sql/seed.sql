USE roam_tourism;

INSERT INTO destinations
  (id, name, location, state, description, category, tags, best_season, climate, highlights, heritage_notes, entry_fee, image_url, rating, featured)
VALUES
  (1, 'Mahabaleshwar', 'Maharashtra, India', 'Maharashtra', 'Slow mornings above the clouds, strawberry fields on the hills, and winding roads that always seem to lead to another beautiful view.', 'mountains', 'hill station, strawberry, fort, lake, maharashtra', 'October to June', 'Cool summers, misty monsoons, and crisp winter mornings.', 'Venna Lake, Pratapgad Fort, Mapro Garden, strawberry farms', 'A hill-station retreat with Maratha-era history and old trading routes.', 200, 'https://images.unsplash.com/photo-1500530855697-b586d89ba3ee?auto=format&fit=crop&w=1200&q=80', 4.8, 1),
  (2, 'Goa', 'Goa, India', 'Goa', 'Find a quieter stretch of sand, linger over lunch in an old Portuguese lane, and watch the sky turn gold at the end of an unhurried day.', 'beach', 'beach, coastal, heritage, seafood, goa', 'November to February', 'Warm coastal weather with a refreshing monsoon season.', 'Palolem Beach, Fontainhas, local seafood, sunset cruises', 'Portuguese and Konkani influences shape the coastal architecture, food, and traditions.', 0, 'https://images.unsplash.com/photo-1512343879784-a960bf40e7f2?auto=format&fit=crop&w=1200&q=80', 4.9, 1),
  (3, 'Jaipur', 'Rajasthan, India', 'Rajasthan', 'Rose-colored facades, early-morning markets, and courtyards that hold centuries of stories make the Pink City easy to fall for.', 'heritage', 'heritage, culture, fort, palace, rajasthan', 'October to March', 'Sunny days, cool winter evenings, and hot summers.', 'Hawa Mahal, Amber Fort, City Palace, historic bazaars', 'Founded in 1727, the Pink City is renowned for its planned streets and royal architecture.', 100, 'https://images.unsplash.com/photo-1599661046827-dacff0c0f09a?auto=format&fit=crop&w=1200&q=80', 4.7, 1),
  (4, 'Munnar', 'Kerala, India', 'Kerala', 'Take the long way through the tea gardens. Up here, every bend in the road comes with mist-softened hills and the smell of rain.', 'nature', 'nature, wildlife, tea gardens, hill station, kerala', 'September to March', 'Mild highland temperatures, misty mornings, and lush monsoons.', 'Eravikulam National Park, tea estates, waterfalls, Top Station', 'Former British-era tea estates sit within a landscape shaped by mountain agriculture.', 50, 'https://images.unsplash.com/photo-1544735716-392fe2489ffa?auto=format&fit=crop&w=1200&q=80', 4.8, 1),
  (5, 'Udaipur', 'Rajasthan, India', 'Rajasthan', 'Stay for the last light over the lake. Wander the narrow lanes, find a little rooftop table, and let the evening take its time.', 'heritage', 'heritage, culture, lakes, palace, rajasthan', 'September to March', 'Dry sunny days with mild, pleasant winter evenings.', 'City Palace, Lake Pichola, Bagore Ki Haveli, old-city walks', 'Historic Mewar capital known for palaces, lakeside havelis, and artisan traditions.', 30, 'https://images.unsplash.com/photo-1567157577867-05ccb1388e66?auto=format&fit=crop&w=1200&q=80', 4.6, 1),
  (6, 'Coorg', 'Karnataka, India', 'Karnataka', 'Wake to coffee-scented air, spend the afternoon among the rainforest trails, and leave just enough time for one more cup.', 'nature', 'nature, coffee, wildlife, waterfalls, karnataka', 'October to March', 'Temperate coffee-country weather with abundant monsoon rain.', 'Abbey Falls, coffee estates, forest trails, Raja’s Seat', 'Kodava cultural traditions and generations of coffee cultivation shape the region.', 0, 'https://images.unsplash.com/photo-1448375240586-882707db888b?auto=format&fit=crop&w=1200&q=80', 4.7, 0),
  (7, 'Dharamshala', 'Himachal Pradesh, India', 'Himachal Pradesh', 'Pine-scented walks, mountain monasteries, and quiet cafés set beneath the Dhauladhar range make room for a slower kind of getaway.', 'nature', 'nature, mountains, spirituality, himachal pradesh, monastery', 'March to June, September to November', 'Cool mountain air, clear spring skies, and snowy winters.', 'McLeod Ganj, Bhagsu Falls, Norbulingka Institute, mountain trails', 'Tibetan cultural life and local Himalayan traditions meet in this mountain town.', 0, 'https://images.unsplash.com/photo-1518005020951-eccb494ad742?auto=format&fit=crop&w=1200&q=80', 4.7, 0),
  (8, 'Amritsar', 'Punjab, India', 'Punjab', 'A city of moving history and generous tables. Visit the Golden Temple at first light, then make time for the old-city lanes.', 'spiritual', 'spiritual, heritage, culture, punjab, golden temple', 'October to March', 'Warm days with cool winters and very hot summers.', 'Golden Temple, Jallianwala Bagh, Partition Museum, Punjabi food', 'The Golden Temple and surrounding old city are central to Sikh history and community life.', 0, 'https://images.unsplash.com/photo-1609947017136-9daf32a5eb16?auto=format&fit=crop&w=1200&q=80', 4.8, 0)
ON DUPLICATE KEY UPDATE
  name = VALUES(name), location = VALUES(location), state = VALUES(state), description = VALUES(description),
  category = VALUES(category), tags = VALUES(tags), best_season = VALUES(best_season),
  climate = VALUES(climate), highlights = VALUES(highlights), heritage_notes = VALUES(heritage_notes),
  entry_fee = VALUES(entry_fee), image_url = VALUES(image_url),
  rating = VALUES(rating), featured = VALUES(featured);

INSERT INTO hotels (destination_id, name, address, rating, price_per_night, available_rooms, amenities)
SELECT d.id, listing.name, listing.address, listing.rating, listing.price_per_night, listing.available_rooms, listing.amenities
FROM (
  SELECT 1 AS destination_id, 'The Fern Hillside Resort' AS name, 'Panchgani Road, Mahabaleshwar' AS address, 4.5 AS rating, 5200 AS price_per_night, 14 AS available_rooms, 'Wi-Fi, pool, breakfast, valley views' AS amenities UNION ALL
  SELECT 1, 'Hotel Green View', 'Near Venna Lake, Mahabaleshwar', 4.6, 3800, 12, 'Wi-Fi, parking, breakfast, family rooms' UNION ALL
  SELECT 2, 'Coco Shambhala Retreat', 'Nerul, North Goa', 4.8, 8400, 8, 'Pool, kitchen, Wi-Fi, garden' UNION ALL
  SELECT 2, 'The Postcard Cuelim', 'Cuelim, South Goa', 4.7, 9200, 10, 'Breakfast, pool, garden, beach transfer' UNION ALL
  SELECT 3, 'Samode Haveli', 'Gangapole, Jaipur', 4.7, 7600, 9, 'Pool, heritage rooms, Wi-Fi, restaurant' UNION ALL
  SELECT 3, 'Pearl Palace Heritage', 'Hathroi Fort, Jaipur', 4.5, 3400, 15, 'Rooftop dining, Wi-Fi, air conditioning' UNION ALL
  SELECT 4, 'Tea County Munnar', 'KTDC Hill Resort, Munnar', 4.4, 4900, 16, 'Tea garden, restaurant, Wi-Fi, parking' UNION ALL
  SELECT 4, 'Blanket Hotel & Spa', 'Attukad Waterfall Road, Munnar', 4.8, 7900, 11, 'Spa, infinity pool, breakfast, valley views' UNION ALL
  SELECT 5, 'Amet Haveli', 'Hanuman Ghat, Udaipur', 4.6, 6800, 10, 'Lake views, rooftop restaurant, Wi-Fi' UNION ALL
  SELECT 5, 'The Leela Palace', 'Lake Pichola, Udaipur', 4.9, 24500, 6, 'Lake transfer, spa, pool, fine dining' UNION ALL
  SELECT 6, 'The Tamara Coorg', 'Yevakapadi, Coorg', 4.8, 14500, 8, 'Coffee estate, spa, pool, restaurant' UNION ALL
  SELECT 6, 'Evolve Back Coorg', 'Siddapur, Coorg', 4.9, 18900, 7, 'Estate villa, dining, pool, guided walks'
  UNION ALL SELECT 7, 'Mountain View Retreat', 'McLeod Ganj, Dharamshala', 4.5, 4200, 8, 'Mountain views, Wi-Fi, breakfast, parking'
  UNION ALL SELECT 8, 'Ramada by Wyndham Amritsar', 'Hall Bazaar, Amritsar', 4.3, 5100, 10, 'Wi-Fi, breakfast, parking, restaurant'
) AS listing
JOIN destinations d ON d.id = listing.destination_id
WHERE NOT EXISTS (
  SELECT 1 FROM hotels h WHERE h.destination_id = d.id AND h.name = listing.name
);

INSERT INTO places (destination_id, name, type, timings, entry_fee, historical_notes, available_tickets)
SELECT d.id, listing.name, listing.type, listing.timings, listing.entry_fee, listing.historical_notes, listing.available_tickets
FROM (
  SELECT 1 AS destination_id, 'Pratapgad Fort' AS name, 'Historic fort' AS type, '9:00 AM – 6:00 PM' AS timings, 50 AS entry_fee, 'A 17th-century hill fort associated with the Maratha era.' AS historical_notes, 500 AS available_tickets UNION ALL
  SELECT 1, 'Venna Lake', 'Lake & boating', '8:00 AM – 8:00 PM', 0, 'A popular lake destination surrounded by forested hills.', 300 UNION ALL
  SELECT 2, 'Palolem Beach', 'Beach', 'Open all day', 0, 'A sheltered crescent beach on Goa’s southern coast.', 500 UNION ALL
  SELECT 2, 'Fontainhas Quarter', 'Heritage neighborhood', 'Open all day', 0, 'A Latin quarter with colorful Portuguese-era homes.', 250 UNION ALL
  SELECT 3, 'Hawa Mahal', 'Historic landmark', '9:00 AM – 4:30 PM', 200, 'An 18th-century palace façade designed for royal viewing.', 400 UNION ALL
  SELECT 3, 'Amber Fort', 'Historic fort', '8:00 AM – 5:30 PM', 500, 'A hilltop palace complex built by the Kachwaha rulers.', 600 UNION ALL
  SELECT 4, 'Eravikulam National Park', 'National park', '8:00 AM – 4:00 PM', 200, 'Protected habitat for the endangered Nilgiri tahr.', 450 UNION ALL
  SELECT 4, 'Top Station Viewpoint', 'Mountain viewpoint', '6:00 AM – 6:00 PM', 0, 'A high-altitude viewpoint along the historic Kannan Devan Hills route.', 200 UNION ALL
  SELECT 5, 'City Palace', 'Museum & palace', '9:30 AM – 5:30 PM', 400, 'A palace complex developed across several generations of Mewar rulers.', 400 UNION ALL
  SELECT 5, 'Lake Pichola', 'Lake & boat rides', '9:00 AM – 6:00 PM', 500, 'An artificial freshwater lake dating to the 14th century.', 200 UNION ALL
  SELECT 6, 'Abbey Falls', 'Waterfall', '9:00 AM – 5:00 PM', 20, 'A waterfall reached by a footpath through coffee and spice plantations.', 350 UNION ALL
  SELECT 6, 'Raja’s Seat', 'Garden & viewpoint', '5:30 AM – 8:00 PM', 10, 'A historic garden viewpoint overlooking the western valleys.', 300
  UNION ALL SELECT 7, 'Bhagsu Waterfall', 'Mountain waterfall', '7:00 AM – 7:00 PM', 0, 'A forest waterfall reached by a scenic mountain trail.', 250
  UNION ALL SELECT 8, 'Partition Museum', 'History museum', '10:00 AM – 6:00 PM', 10, 'A museum preserving oral histories and artifacts from the 1947 Partition.', 200
) AS listing
JOIN destinations d ON d.id = listing.destination_id
WHERE NOT EXISTS (
  SELECT 1 FROM places p WHERE p.destination_id = d.id AND p.name = listing.name
);

INSERT INTO restaurants (destination_id, name, address, rating, cuisine, average_cost, operating_hours, available_tables)
SELECT d.id, listing.name, listing.address, listing.rating, listing.cuisine, listing.average_cost, listing.operating_hours, listing.available_tables
FROM (
  SELECT 1 AS destination_id, 'Mapro Garden Restaurant' AS name, 'Panchgani–Mahabaleshwar Road' AS address, 4.5 AS rating, 'Indian, cafe, vegetarian' AS cuisine, 1100 AS average_cost, '9:00 AM – 9:00 PM' AS operating_hours, 18 AS available_tables UNION ALL
  SELECT 1, 'The Grapevine', 'Market Road, Mahabaleshwar', 4.3, 'Indian, continental', 1400, '12:00 PM – 10:00 PM', 12 UNION ALL
  SELECT 2, 'Gunpowder', 'Assagao, North Goa', 4.7, 'South Indian, coastal', 1800, '12:00 PM – 10:30 PM', 15 UNION ALL
  SELECT 2, 'Fisherman’s Wharf', 'Cavelossim, South Goa', 4.4, 'Goan, seafood', 2200, '12:00 PM – 11:00 PM', 20 UNION ALL
  SELECT 3, 'Tapri Central', 'C Scheme, Jaipur', 4.5, 'Indian, cafe', 900, '8:00 AM – 10:30 PM', 16 UNION ALL
  SELECT 3, '1135 AD', 'Amber Fort, Jaipur', 4.4, 'Rajasthani, Indian', 2600, '12:00 PM – 10:00 PM', 12 UNION ALL
  SELECT 4, 'Rapsy Restaurant', 'Old Munnar, Munnar', 4.2, 'Kerala, Indian, cafe', 800, '8:00 AM – 10:00 PM', 14 UNION ALL
  SELECT 4, 'Rochas Restaurant', 'Pallivasal, Munnar', 4.3, 'Indian, continental', 1300, '12:00 PM – 10:00 PM', 12 UNION ALL
  SELECT 5, 'Ambrai Restaurant', 'Amet Haveli, Udaipur', 4.5, 'Rajasthani, Indian', 2100, '12:00 PM – 10:30 PM', 18 UNION ALL
  SELECT 5, 'Natraj Dining Hall', 'City Station Road, Udaipur', 4.3, 'Rajasthani thali, vegetarian', 700, '11:00 AM – 10:00 PM', 20 UNION ALL
  SELECT 6, 'Coorg Cuisine', 'Stuart Hill, Madikeri', 4.4, 'Kodava, Coorgi', 1200, '12:00 PM – 9:30 PM', 12 UNION ALL
  SELECT 6, 'Raintree Restaurants', 'Club Mahindra Road, Madikeri', 4.3, 'Indian, Coorgi', 1600, '7:00 AM – 10:00 PM', 14
  UNION ALL SELECT 7, 'Moonpeak Espresso', 'Jogiwara Road, McLeod Ganj', 4.5, 'Cafe, Tibetan, vegetarian', 800, '8:00 AM – 9:00 PM', 10
  UNION ALL SELECT 8, 'Kesar Da Dhaba', 'Chowk Passian, Amritsar', 4.5, 'Punjabi, vegetarian', 900, '12:00 PM – 10:00 PM', 14
) AS listing
JOIN destinations d ON d.id = listing.destination_id
WHERE NOT EXISTS (
  SELECT 1 FROM restaurants r WHERE r.destination_id = d.id AND r.name = listing.name
);
