CREATE TABLE "listen" (
	"listener_id" text NOT NULL,
	"submission_key" text NOT NULL,
	"album_id" text NOT NULL,
	"listen_date" date NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "listen_listener_id_submission_key_pk" PRIMARY KEY("listener_id","submission_key")
);
--> statement-breakpoint
ALTER TABLE "listen" ADD CONSTRAINT "listen_listener_id_user_id_fk" FOREIGN KEY ("listener_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "listen" ADD CONSTRAINT "listen_album_id_album_id_fk" FOREIGN KEY ("album_id") REFERENCES "public"."album"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "listen_listener_date_idx" ON "listen" USING btree ("listener_id","listen_date");