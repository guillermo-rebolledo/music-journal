# Music journal

A listener's private record of album listens and music they want to explore. This vocabulary is grounded in [Music journal v0, issue #1](https://github.com/guillermo-rebolledo/music-journal/issues/1).

## Language

### Music and identity

**Listener**
The person who owns a private journal, Want to Listen list, and Saved Artists list, accessible through their signed-in account across devices.
_Avoid_ — customer, profile owner.

**Catalog**
The collection of album and artist identities and descriptive details used for search, journal pages, and discovery.
_Avoid_ — library, journal.

**Album**
A musical release grouped with its common reissues under one identity and one journal detail page. The initial catalog includes releases classified primarily as albums.
_Avoid_ — edition, track, playlist.

**Artist**
A named musical person or group with a distinct catalog identity. A distinguishing detail, when available, helps listeners tell artists with the same name apart.
_Avoid_ — band when referring to artists generally.

**Credited artist**
The artist credit displayed for an album, preserving the credited wording used to identify that album.
_Avoid_ — album owner.

**Original release year**
The year an album was first released, when known, used alongside its title and credited artist to distinguish it.
_Avoid_ — reissue year, listen year.

### Journal and wishlists

**Journal**
The listener's private destination containing dated album listens, Want to Listen, and Saved Artists.
_Avoid_ — Catalog, playlist.

**Listen**
A dated record that a listener heard an album, created by explicitly logging it. Separate listens to the same album may share a date.
_Avoid_ — play, scrobble, track log.

**Listen date**
The calendar date the listener assigns to a listen, defaulting to today and adjustable to record an earlier listen.
_Avoid_ — save date, release date.

**Repeat listen**
A further listen to an album the listener has already logged, recorded as its own listen.
_Avoid_ — duplicate listen, retry.

**Listened status**
The fact that a listener has at least one recorded listen for an album. An album with listened status can also be in Want to Listen for a future revisit.
_Avoid_ — completed, permanently finished.

**Want to Listen**
The listener's album wishlist, containing at most one membership per album and also called the queue in the spec. Logging a new listen removes that album's current membership, and the listener may save it again later.
_Avoid_ — playlist, listening history, On Rotation.

**Saved Artists**
The listener's artist wishlist, containing at most one membership per artist and providing the possible seeds for Discover.
_Avoid_ — favorite artists, followed artists, Want to Listen.

### Discovery

**Discover**
The destination for finding music through a handpicked starter shelf or suggestions based on a listener-selected saved artist.
_Avoid_ — Journal, search results.

**Seed artist**
The single artist the listener chooses from Saved Artists as the basis for the current discovery suggestions.
_Avoid_ — favorite artist, related artist.

**Related artist**
An artist suggested as similar to the selected seed artist, excluding the seed itself. A related artist may appear even when a suitable album suggestion is unavailable.
_Avoid_ — seed artist, saved artist unless already saved.

**Suggested album**
A released full album offered as a starting point for exploring a related artist, with at most one album per related artist. Discovery suggestions exclude albums the listener has already saved or logged and support the same save and log actions as search results.
_Avoid_ — top track, playlist.

**Handpicked shelf**
A small curated selection of albums available in Discover for first use and during discovery-provider downtime.
_Avoid_ — personalized recommendations, related artists.
