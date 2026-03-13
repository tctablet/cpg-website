// ── CPG_BEATS — Supabase Backend ──
const SUPABASE_URL = 'https://afdonsiovckfbccxrcgi.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImFmZG9uc2lvdmNrZmJjY3hyY2dpIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzMzMjAyMzEsImV4cCI6MjA4ODg5NjIzMX0.8Zd7XRgbD8NleFzkK_9AU5lnKBcKftzy_lMyDxfpUVU';

const _sb = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

const BeatsAPI = {
    /** Load all public beats, newest first */
    async getAll() {
        const { data, error } = await _sb
            .from('beats')
            .select('*')
            .eq('is_public', true)
            .order('created_at', { ascending: false });
        if (error) { console.error('[BeatsAPI] getAll:', error); return []; }
        return data;
    },

    /** Load a single beat by id */
    async getById(id) {
        const { data, error } = await _sb
            .from('beats')
            .select('*')
            .eq('id', id)
            .single();
        if (error) { console.error('[BeatsAPI] getById:', error); return null; }
        return data;
    },
};

// ── Admin client (service_role for storage uploads, bypasses RLS) ──
const SUPABASE_SERVICE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImFmZG9uc2lvdmNrZmJjY3hyY2dpIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3MzMyMDIzMSwiZXhwIjoyMDg4ODk2MjMxfQ.51P09FLp_obDXQABEbxMjOvVmfJgMLFHUWDtXArudK0';
const _sbAdmin = supabase.createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
});

// ── Admin API (requires Supabase Auth session) ──
const AdminAPI = {
    /** Sign in with email + password */
    async login(email, password) {
        const { data, error } = await _sb.auth.signInWithPassword({ email, password });
        if (error) throw error;
        return data;
    },

    /** Sign out */
    async logout() {
        const { error } = await _sb.auth.signOut();
        if (error) throw error;
    },

    /** Get current session */
    async getSession() {
        const { data } = await _sb.auth.getSession();
        return data.session;
    },

    /** Load ALL beats (including non-public), newest first */
    async getAllBeats() {
        const { data, error } = await _sbAdmin
            .from('beats')
            .select('*')
            .order('created_at', { ascending: false });
        if (error) { console.error('[AdminAPI] getAllBeats:', error); return []; }
        return data;
    },

    /** Create a new beat */
    async createBeat(beat) {
        const { data, error } = await _sbAdmin
            .from('beats')
            .insert(beat)
            .select()
            .single();
        if (error) throw error;
        return data;
    },

    /** Update an existing beat */
    async updateBeat(id, updates) {
        const { data, error } = await _sbAdmin
            .from('beats')
            .update(updates)
            .eq('id', id)
            .select()
            .single();
        if (error) throw error;
        return data;
    },

    /** Delete a beat */
    async deleteBeat(id) {
        const { error } = await _sbAdmin
            .from('beats')
            .delete()
            .eq('id', id);
        if (error) throw error;
    },

    /** Upload audio file to Supabase Storage (uses XHR for progress tracking) */
    async uploadAudio(file, onProgress) {
        const name = `${Date.now()}_${file.name.replace(/[^a-zA-Z0-9._-]/g, '_')}`;
        const url = `${SUPABASE_URL}/storage/v1/object/beats/${name}`;

        await new Promise((resolve, reject) => {
            const xhr = new XMLHttpRequest();
            xhr.open('POST', url);
            xhr.setRequestHeader('Authorization', `Bearer ${SUPABASE_SERVICE_KEY}`);
            xhr.setRequestHeader('Content-Type', file.type || 'audio/mpeg');
            if (onProgress) {
                xhr.upload.addEventListener('progress', e => {
                    if (e.lengthComputable) onProgress(e.loaded / e.total);
                });
            }
            xhr.onload = () => {
                if (xhr.status >= 200 && xhr.status < 300) resolve();
                else reject(new Error(`Upload failed (${xhr.status})`));
            };
            xhr.onerror = () => reject(new Error('Upload network error'));
            xhr.send(file);
        });

        const { data: urlData } = _sbAdmin.storage.from('beats').getPublicUrl(name);
        return urlData.publicUrl;
    },

    /** Delete audio file from Supabase Storage (uses service_role client) */
    async deleteAudio(url) {
        const path = url.split('/storage/v1/object/public/beats/').pop();
        if (!path) return;
        const { error } = await _sbAdmin.storage.from('beats').remove([path]);
        if (error) console.warn('[AdminAPI] deleteAudio:', error);
    },

    // ── Playlist Management ──

    /** Load all playlists with beat count and feedback status */
    async getAllPlaylists() {
        const { data, error } = await _sbAdmin
            .from('playlists')
            .select('*, playlist_beats(count), beat_ratings(count)')
            .order('created_at', { ascending: false });
        if (error) { console.error('[AdminAPI] getAllPlaylists:', error); return []; }
        return data;
    },

    /** Get playlist detail with beats and ratings */
    async getPlaylistDetail(id) {
        const { data: playlist, error: pErr } = await _sbAdmin
            .from('playlists')
            .select('*')
            .eq('id', id)
            .single();
        if (pErr) throw pErr;

        const { data: pBeats, error: bErr } = await _sbAdmin
            .from('playlist_beats')
            .select('*, beats(*)')
            .eq('playlist_id', id)
            .order('position');
        if (bErr) throw bErr;

        const { data: ratings, error: rErr } = await _sbAdmin
            .from('beat_ratings')
            .select('*')
            .eq('playlist_id', id);
        if (rErr) throw rErr;

        return { playlist, beats: pBeats, ratings };
    },

    /** Create a new playlist */
    async createPlaylist(data) {
        const { data: pl, error } = await _sbAdmin
            .from('playlists')
            .insert(data)
            .select()
            .single();
        if (error) throw error;
        return pl;
    },

    /** Update a playlist */
    async updatePlaylist(id, updates) {
        const { data, error } = await _sbAdmin
            .from('playlists')
            .update(updates)
            .eq('id', id)
            .select()
            .single();
        if (error) throw error;
        return data;
    },

    /** Delete a playlist */
    async deletePlaylist(id) {
        const { error } = await _sbAdmin
            .from('playlists')
            .delete()
            .eq('id', id);
        if (error) throw error;
    },

    /** Set beats for a playlist (replace all) */
    async setPlaylistBeats(playlistId, beatIds) {
        // Remove existing
        await _sbAdmin
            .from('playlist_beats')
            .delete()
            .eq('playlist_id', playlistId);

        // Insert new
        if (beatIds.length > 0) {
            const rows = beatIds.map((beatId, i) => ({
                playlist_id: playlistId,
                beat_id: beatId,
                position: i,
            }));
            const { error } = await _sbAdmin
                .from('playlist_beats')
                .insert(rows);
            if (error) throw error;
        }
    },

    /** Generate a random share token */
    generateToken() {
        const chars = 'abcdefghijkmnpqrstuvwxyz23456789';
        let token = '';
        for (let i = 0; i < 10; i++) token += chars[Math.floor(Math.random() * chars.length)];
        return token;
    },
};

// ── Public Playlist API (uses anon key, respects RLS) ──
const PlaylistAPI = {
    /** Get playlist by share token (via RPC) */
    async getByToken(token) {
        const { data, error } = await _sb.rpc('get_playlist_by_token', { p_token: token });
        if (error) { console.error('[PlaylistAPI] getByToken:', error); return null; }
        return data;
    },

    /** Submit/update a beat rating */
    async rateBeat(token, beatId, rating, comment) {
        const { data, error } = await _sb.rpc('submit_beat_rating', {
            p_token: token,
            p_beat_id: beatId,
            p_rating: rating,
            p_comment: comment || null,
        });
        if (error) throw error;
        if (data?.error) throw new Error(data.error);
        return data;
    },

    /** Submit overall text feedback */
    async submitFeedback(token, feedback) {
        const { data, error } = await _sb.rpc('submit_playlist_feedback', {
            p_token: token,
            p_feedback: feedback,
        });
        if (error) throw error;
        if (data?.error) throw new Error(data.error);
        return data;
    },
};
