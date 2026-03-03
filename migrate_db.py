import sqlite3
from config import config

def migrate():
    print(f"Connecting to database at {config.DB_PATH}...")
    conn = sqlite3.connect(config.DB_PATH)
    cursor = conn.cursor()
    
    try:
        # Check if column exists
        cursor.execute("PRAGMA table_info(news)")
        columns = [info[1] for info in cursor.fetchall()]
        
        if 'summary' not in columns:
            print("Adding 'summary' column to 'news' table...")
            cursor.execute("ALTER TABLE news ADD COLUMN summary TEXT")
            conn.commit()
            print("Migration successful.")
        else:
            print("'summary' column already exists.")
            
    except Exception as e:
        print(f"Error during migration: {e}")
    finally:
        conn.close()

if __name__ == '__main__':
    migrate()
