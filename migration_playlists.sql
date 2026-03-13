-- ══════════════════════════════════════════════════════════════
-- CPG_BEATS — Playlist Feature Migration
-- Run this in Supabase SQL Editor (https://supabase.com/dashboard)
-- ══════════════════════════════════════════════════════════════

-- ── 1. PLAYLISTS TABLE ──
CREATE TABLE playlists (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL,
    rapper_name TEXT NOT NULL,
    share_token TEXT UNIQUE NOT NULL,
    is_active BOOLEAN DEFAULT true,
    notes TEXT,
    feedback_text TEXT,
    feedback_submitted_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT now()
);

-- ── 2. PLAYLIST_BEATS TABLE (join table) ──
CREATE TABLE playlist_beats (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    playlist_id UUID NOT NULL REFERENCES playlists(id) ON DELETE CASCADE,
    beat_id UUID NOT NULL REFERENCES beats(id) ON DELETE CASCADE,
    position INTEGER DEFAULT 0,
    created_at TIMESTAMPTZ DEFAULT now(),
    UNIQUE(playlist_id, beat_id)
);

-- ── 3. BEAT_RATINGS TABLE ──
CREATE TABLE beat_ratings (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    playlist_id UUID NOT NULL REFERENCES playlists(id) ON DELETE CASCADE,
    beat_id UUID NOT NULL REFERENCES beats(id) ON DELETE CASCADE,
    rating INTEGER NOT NULL CHECK (rating >= 1 AND rating <= 5),
    comment TEXT,
    created_at TIMESTAMPTZ DEFAULT now(),
    UNIQUE(playlist_id, beat_id)
);

-- ── 4. INDEXES ──
CREATE INDEX idx_playlists_share_token ON playlists(share_token);
CREATE INDEX idx_playlist_beats_playlist ON playlist_beats(playlist_id);
CREATE INDEX idx_beat_ratings_playlist ON beat_ratings(playlist_id);

-- ── 5. ROW LEVEL SECURITY ──
ALTER TABLE playlists ENABLE ROW LEVEL SECURITY;
ALTER TABLE playlist_beats ENABLE ROW LEVEL SECURITY;
ALTER TABLE beat_ratings ENABLE ROW LEVEL SECURITY;

-- Anon: can read active playlists (filtered by share_token in query)
CREATE POLICY "anon_select_active_playlists" ON playlists
    FOR SELECT USING (is_active = true);

-- Anon: can update feedback on active playlists
CREATE POLICY "anon_update_playlist_feedback" ON playlists
    FOR UPDATE USING (is_active = true)
    WITH CHECK (is_active = true);

-- Anon: can read playlist_beats for active playlists
CREATE POLICY "anon_select_playlist_beats" ON playlist_beats
    FOR SELECT USING (
        EXISTS (SELECT 1 FROM playlists WHERE id = playlist_id AND is_active = true)
    );

-- Anon: can read beat_ratings
CREATE POLICY "anon_select_beat_ratings" ON beat_ratings
    FOR SELECT USING (true);

-- Anon: can insert beat_ratings
CREATE POLICY "anon_insert_beat_ratings" ON beat_ratings
    FOR INSERT WITH CHECK (
        EXISTS (SELECT 1 FROM playlists WHERE id = playlist_id AND is_active = true)
    );

-- Anon: can update own beat_ratings (upsert)
CREATE POLICY "anon_update_beat_ratings" ON beat_ratings
    FOR UPDATE USING (
        EXISTS (SELECT 1 FROM playlists WHERE id = playlist_id AND is_active = true)
    );

-- ── 6. RPC FUNCTIONS ──

-- Get playlist with beats by share token
CREATE OR REPLACE FUNCTION get_playlist_by_token(p_token TEXT)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    result JSON;
BEGIN
    SELECT json_build_object(
        'playlist', json_build_object(
            'id', p.id,
            'name', p.name,
            'rapper_name', p.rapper_name,
            'is_active', p.is_active,
            'feedback_text', p.feedback_text,
            'feedback_submitted_at', p.feedback_submitted_at,
            'created_at', p.created_at
        ),
        'beats', COALESCE((
            SELECT json_agg(
                json_build_object(
                    'id', b.id,
                    'title', b.title,
                    'bpm', b.bpm,
                    'key', b.key,
                    'type', b.type,
                    'audio_url', b.audio_url,
                    'duration', b.duration,
                    'position', pb.position
                ) ORDER BY pb.position, pb.created_at
            )
            FROM playlist_beats pb
            JOIN beats b ON b.id = pb.beat_id
            WHERE pb.playlist_id = p.id
        ), '[]'::json),
        'ratings', COALESCE((
            SELECT json_agg(
                json_build_object(
                    'beat_id', br.beat_id,
                    'rating', br.rating,
                    'comment', br.comment,
                    'created_at', br.created_at
                )
            )
            FROM beat_ratings br
            WHERE br.playlist_id = p.id
        ), '[]'::json)
    ) INTO result
    FROM playlists p
    WHERE p.share_token = p_token AND p.is_active = true;

    RETURN result;
END;
$$;

-- Submit/update a beat rating
CREATE OR REPLACE FUNCTION submit_beat_rating(
    p_token TEXT,
    p_beat_id UUID,
    p_rating INTEGER,
    p_comment TEXT DEFAULT NULL
)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_playlist_id UUID;
    result JSON;
BEGIN
    -- Find active playlist by token
    SELECT id INTO v_playlist_id
    FROM playlists
    WHERE share_token = p_token AND is_active = true;

    IF v_playlist_id IS NULL THEN
        RETURN json_build_object('error', 'Playlist nicht gefunden');
    END IF;

    -- Verify beat is in this playlist
    IF NOT EXISTS (
        SELECT 1 FROM playlist_beats
        WHERE playlist_id = v_playlist_id AND beat_id = p_beat_id
    ) THEN
        RETURN json_build_object('error', 'Beat nicht in Playlist');
    END IF;

    -- Upsert rating
    INSERT INTO beat_ratings (playlist_id, beat_id, rating, comment)
    VALUES (v_playlist_id, p_beat_id, p_rating, p_comment)
    ON CONFLICT (playlist_id, beat_id)
    DO UPDATE SET rating = p_rating, comment = p_comment, created_at = now();

    SELECT json_build_object('success', true, 'beat_id', p_beat_id, 'rating', p_rating)
    INTO result;

    RETURN result;
END;
$$;

-- Submit overall text feedback
CREATE OR REPLACE FUNCTION submit_playlist_feedback(p_token TEXT, p_feedback TEXT)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_playlist_id UUID;
BEGIN
    SELECT id INTO v_playlist_id
    FROM playlists
    WHERE share_token = p_token AND is_active = true;

    IF v_playlist_id IS NULL THEN
        RETURN json_build_object('error', 'Playlist nicht gefunden');
    END IF;

    UPDATE playlists
    SET feedback_text = p_feedback, feedback_submitted_at = now()
    WHERE id = v_playlist_id;

    RETURN json_build_object('success', true);
END;
$$;
