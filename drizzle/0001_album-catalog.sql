CREATE TABLE "album" (
	"id" text PRIMARY KEY NOT NULL,
	"title" text NOT NULL,
	"credited_artist" text NOT NULL,
	"original_year" integer,
	"cover_reference" text
);
--> statement-breakpoint
CREATE TABLE "catalog_cache" (
	"key" text PRIMARY KEY NOT NULL,
	"value" jsonb NOT NULL,
	"expires_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "provider_limit" (
	"provider" text PRIMARY KEY NOT NULL,
	"next_request_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "want_to_listen" (
	"listener_id" text NOT NULL,
	"album_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "want_to_listen_listener_id_album_id_pk" PRIMARY KEY("listener_id","album_id")
);
--> statement-breakpoint
ALTER TABLE "want_to_listen" ADD CONSTRAINT "want_to_listen_listener_id_user_id_fk" FOREIGN KEY ("listener_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "want_to_listen" ADD CONSTRAINT "want_to_listen_album_id_album_id_fk" FOREIGN KEY ("album_id") REFERENCES "public"."album"("id") ON DELETE no action ON UPDATE no action;