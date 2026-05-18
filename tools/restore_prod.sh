#!/bin/bash

export PGCHANNELBINDING=disable
echo "Dumping production database..."
/usr/lib/postgresql/18/bin/pg_dump "postgresql://readonly_dump_user:QglbllTdsu7Anb7TowsN5zBOJEykLdk2@dpg-d6k1mdp5pdvs73dpb3d0-a.frankfurt-postgres.render.com:5432/maintenance_n9ro?sslmode=require" -Fc --no-owner --no-privileges -f /tmp/maintenance_n9ro.dump

echo "Restoring to local database..."
/usr/lib/postgresql/18/bin/pg_restore --list /tmp/maintenance_n9ro.dump > /tmp/maintenance_n9ro.list
grep -v "pg_stat_statements" /tmp/maintenance_n9ro.list > /tmp/maintenance_n9ro_filtered.list
/usr/lib/postgresql/18/bin/pg_restore --clean --no-owner --no-privileges --if-exists --use-list=/tmp/maintenance_n9ro_filtered.list --dbname="$DATABASE_URL" /tmp/maintenance_n9ro.dump
