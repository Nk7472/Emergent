from fastapi import FastAPI, APIRouter, HTTPException, Depends
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from dotenv import load_dotenv
from starlette.middleware.cors import CORSMiddleware
from motor.motor_asyncio import AsyncIOMotorClient
import os
import logging
from pathlib import Path
from pydantic import BaseModel, Field, ConfigDict
from typing import List, Optional
import uuid
from datetime import datetime, timezone

ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / '.env')

# MongoDB connection
mongo_url = os.environ['MONGO_URL']
client = AsyncIOMotorClient(mongo_url)
db = client[os.environ['DB_NAME']]

# Create the main app
app = FastAPI()
api_router = APIRouter(prefix="/api")
security = HTTPBearer()

# Pydantic Models
class Player(BaseModel):
    model_config = ConfigDict(extra="ignore")
    
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    username: str
    email: str
    avatar: str = "default"
    level: int = 1
    xp: int = 0
    coins: int = 1000
    diamonds: int = 50
    rank: str = "Bronze"
    wins: int = 0
    losses: int = 0
    goals: int = 0
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))

class PlayerCreate(BaseModel):
    username: str
    email: str

class PlayerUpdate(BaseModel):
    avatar: Optional[str] = None
    level: Optional[int] = None
    xp: Optional[int] = None
    coins: Optional[int] = None
    diamonds: Optional[int] = None
    rank: Optional[str] = None
    wins: Optional[int] = None
    losses: Optional[int] = None
    goals: Optional[int] = None

class CarCustomization(BaseModel):
    model_config = ConfigDict(extra="ignore")
    
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    player_id: str
    car_model: str = "default"
    body_color: str = "#3B82F6"
    decal: str = "none"
    wheels: str = "default"
    boost_effect: str = "blue"
    goal_explosion: str = "default"
    updated_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))

class CarCustomizationCreate(BaseModel):
    player_id: str
    car_model: Optional[str] = "default"
    body_color: Optional[str] = "#3B82F6"
    decal: Optional[str] = "none"
    wheels: Optional[str] = "default"
    boost_effect: Optional[str] = "blue"
    goal_explosion: Optional[str] = "default"

class CarCustomizationUpdate(BaseModel):
    car_model: Optional[str] = None
    body_color: Optional[str] = None
    decal: Optional[str] = None
    wheels: Optional[str] = None
    boost_effect: Optional[str] = None
    goal_explosion: Optional[str] = None

class MatchResult(BaseModel):
    model_config = ConfigDict(extra="ignore")
    
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    player_id: str
    match_type: str = "1v1"
    result: str  # "win" or "loss"
    player_goals: int
    opponent_goals: int
    duration: int  # in seconds
    xp_earned: int
    coins_earned: int
    timestamp: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))

class MatchResultCreate(BaseModel):
    player_id: str
    match_type: str = "1v1"
    result: str
    player_goals: int
    opponent_goals: int
    duration: int
    xp_earned: int
    coins_earned: int

class Leaderboard(BaseModel):
    username: str
    wins: int
    goals: int
    rank: str
    level: int

# API Routes
@api_router.get("/")
async def root():
    return {"message": "Boost Ball Arena API", "version": "1.0.0"}

# Player endpoints
@api_router.post("/players", response_model=Player)
async def create_player(player_data: PlayerCreate):
    existing = await db.players.find_one({"email": player_data.email})
    if existing:
        raise HTTPException(400, "Player with this email already exists")
    
    player = Player(**player_data.model_dump())
    doc = player.model_dump()
    doc['created_at'] = doc['created_at'].isoformat()
    
    await db.players.insert_one(doc)
    return player

@api_router.get("/players/{player_id}", response_model=Player)
async def get_player(player_id: str):
    player = await db.players.find_one({"id": player_id}, {"_id": 0})
    if not player:
        raise HTTPException(404, "Player not found")
    
    if isinstance(player.get('created_at'), str):
        player['created_at'] = datetime.fromisoformat(player['created_at'])
    
    return player

@api_router.get("/players/email/{email}", response_model=Player)
async def get_player_by_email(email: str):
    player = await db.players.find_one({"email": email}, {"_id": 0})
    if not player:
        raise HTTPException(404, "Player not found")
    
    if isinstance(player.get('created_at'), str):
        player['created_at'] = datetime.fromisoformat(player['created_at'])
    
    return player

@api_router.patch("/players/{player_id}", response_model=Player)
async def update_player(player_id: str, updates: PlayerUpdate):
    update_data = {k: v for k, v in updates.model_dump().items() if v is not None}
    if not update_data:
        raise HTTPException(400, "No valid fields to update")
    
    result = await db.players.update_one(
        {"id": player_id},
        {"$set": update_data}
    )
    
    if result.matched_count == 0:
        raise HTTPException(404, "Player not found")
    
    updated_player = await db.players.find_one({"id": player_id}, {"_id": 0})
    if isinstance(updated_player.get('created_at'), str):
        updated_player['created_at'] = datetime.fromisoformat(updated_player['created_at'])
    
    return updated_player

# Car customization endpoints
@api_router.post("/customization", response_model=CarCustomization)
async def create_customization(custom_data: CarCustomizationCreate):
    existing = await db.customizations.find_one({"player_id": custom_data.player_id})
    if existing:
        raise HTTPException(400, "Customization already exists for this player")
    
    customization = CarCustomization(**custom_data.model_dump())
    doc = customization.model_dump()
    doc['updated_at'] = doc['updated_at'].isoformat()
    
    await db.customizations.insert_one(doc)
    return customization

@api_router.get("/customization/{player_id}", response_model=CarCustomization)
async def get_customization(player_id: str):
    custom = await db.customizations.find_one({"player_id": player_id}, {"_id": 0})
    if not custom:
        # Create default customization
        default_custom = CarCustomization(player_id=player_id)
        doc = default_custom.model_dump()
        doc['updated_at'] = doc['updated_at'].isoformat()
        await db.customizations.insert_one(doc)
        return default_custom
    
    if isinstance(custom.get('updated_at'), str):
        custom['updated_at'] = datetime.fromisoformat(custom['updated_at'])
    
    return custom

@api_router.patch("/customization/{player_id}", response_model=CarCustomization)
async def update_customization(player_id: str, updates: CarCustomizationUpdate):
    update_data = {k: v for k, v in updates.model_dump().items() if v is not None}
    if not update_data:
        raise HTTPException(400, "No valid fields to update")
    
    update_data['updated_at'] = datetime.now(timezone.utc).isoformat()
    
    result = await db.customizations.update_one(
        {"player_id": player_id},
        {"$set": update_data}
    )
    
    if result.matched_count == 0:
        raise HTTPException(404, "Customization not found")
    
    updated = await db.customizations.find_one({"player_id": player_id}, {"_id": 0})
    if isinstance(updated.get('updated_at'), str):
        updated['updated_at'] = datetime.fromisoformat(updated['updated_at'])
    
    return updated

# Match result endpoints
@api_router.post("/matches", response_model=MatchResult)
async def create_match_result(match_data: MatchResultCreate):
    match = MatchResult(**match_data.model_dump())
    doc = match.model_dump()
    doc['timestamp'] = doc['timestamp'].isoformat()
    
    await db.matches.insert_one(doc)
    
    # Update player stats
    player = await db.players.find_one({"id": match_data.player_id})
    if player:
        updates = {
            "xp": player.get('xp', 0) + match_data.xp_earned,
            "coins": player.get('coins', 0) + match_data.coins_earned,
            "goals": player.get('goals', 0) + match_data.player_goals
        }
        
        if match_data.result == "win":
            updates["wins"] = player.get('wins', 0) + 1
        else:
            updates["losses"] = player.get('losses', 0) + 1
        
        # Level up logic
        new_xp = updates['xp']
        new_level = player.get('level', 1)
        while new_xp >= new_level * 100:
            new_xp -= new_level * 100
            new_level += 1
        updates['level'] = new_level
        
        # Rank progression
        if updates['wins'] >= 50:
            updates['rank'] = "Diamond"
        elif updates['wins'] >= 30:
            updates['rank'] = "Platinum"
        elif updates['wins'] >= 15:
            updates['rank'] = "Gold"
        elif updates['wins'] >= 5:
            updates['rank'] = "Silver"
        
        await db.players.update_one({"id": match_data.player_id}, {"$set": updates})
    
    return match

@api_router.get("/matches/player/{player_id}", response_model=List[MatchResult])
async def get_player_matches(player_id: str, limit: int = 10):
    matches = await db.matches.find(
        {"player_id": player_id},
        {"_id": 0}
    ).sort("timestamp", -1).limit(limit).to_list(limit)
    
    for match in matches:
        if isinstance(match.get('timestamp'), str):
            match['timestamp'] = datetime.fromisoformat(match['timestamp'])
    
    return matches

# Leaderboard endpoint
@api_router.get("/leaderboard", response_model=List[Leaderboard])
async def get_leaderboard(limit: int = 10):
    players = await db.players.find(
        {},
        {"_id": 0, "username": 1, "wins": 1, "goals": 1, "rank": 1, "level": 1}
    ).sort("wins", -1).limit(limit).to_list(limit)
    
    return players

# Include router
app.include_router(api_router)

# CORS middleware
app.add_middleware(
    CORSMiddleware,
    allow_credentials=True,
    allow_origins=os.environ.get('CORS_ORIGINS', '*').split(','),
    allow_methods=["*"],
    allow_headers=["*"],
)

# Logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)

@app.on_event("shutdown")
async def shutdown_db_client():
    client.close()