-- Add kindle_email to user_preferences for Send to Kindle feature
alter table user_preferences add column if not exists kindle_email text;
