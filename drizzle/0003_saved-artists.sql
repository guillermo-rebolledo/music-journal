CREATE TABLE "artist" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"disambiguation" text
);
--> statement-breakpoint
CREATE TABLE "saved_artist" (
	"listener_id" text NOT NULL,
	"artist_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "saved_artist_listener_id_artist_id_pk" PRIMARY KEY("listener_id","artist_id")
);
--> statement-breakpoint
ALTER TABLE "saved_artist" ADD CONSTRAINT "saved_artist_listener_id_user_id_fk" FOREIGN KEY ("listener_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "saved_artist" ADD CONSTRAINT "saved_artist_artist_id_artist_id_fk" FOREIGN KEY ("artist_id") REFERENCES "public"."artist"("id") ON DELETE no action ON UPDATE no action;