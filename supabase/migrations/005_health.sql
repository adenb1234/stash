-- Health tracking: weight log + calorie log
-- Run this in your Supabase SQL Editor.

CREATE TABLE weight_entries (
  id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  entry_date DATE NOT NULL DEFAULT CURRENT_DATE,
  weight NUMERIC(6,2) NOT NULL,
  unit TEXT NOT NULL DEFAULT 'lbs' CHECK (unit IN ('lbs', 'kg')),
  note TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE TABLE food_entries (
  id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  entry_date DATE NOT NULL DEFAULT CURRENT_DATE,
  name TEXT NOT NULL,
  calories INTEGER NOT NULL CHECK (calories >= 0),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX weight_entries_user_date_idx ON weight_entries(user_id, entry_date DESC);
CREATE INDEX food_entries_user_date_idx ON food_entries(user_id, entry_date DESC);

ALTER TABLE weight_entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE food_entries ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own weight_entries" ON weight_entries
  FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can insert own weight_entries" ON weight_entries
  FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can update own weight_entries" ON weight_entries
  FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "Users can delete own weight_entries" ON weight_entries
  FOR DELETE USING (auth.uid() = user_id);

CREATE POLICY "Users can view own food_entries" ON food_entries
  FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can insert own food_entries" ON food_entries
  FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can update own food_entries" ON food_entries
  FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "Users can delete own food_entries" ON food_entries
  FOR DELETE USING (auth.uid() = user_id);
