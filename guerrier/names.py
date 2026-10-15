"""Génération de noms de guerriers rigolos, déterministes à partir du nom du pod.

Le même POD_NAME donne toujours le même nom d'affichage : si le conteneur
redémarre (livenessProbe), le guerrier garde son identité.
"""
import hashlib

# (prénom, genre) — le genre sert à accorder l'épithète
PRENOMS = [
    ("Gérard", "m"), ("Josiane", "f"), ("Kevin", "m"), ("Ginette", "f"),
    ("Jean-Michel", "m"), ("Brigitte", "f"), ("Bernard", "m"), ("Monique", "f"),
    ("Dylan", "m"), ("Jennifer", "f"), ("Thierry", "m"), ("Chantal", "f"),
    ("Patrick", "m"), ("Sandrine", "f"), ("Didier", "m"), ("Nathalie", "f"),
    ("Régis", "m"), ("Huguette", "f"), ("Jacky", "m"), ("Pascale", "f"),
    ("Roger", "m"), ("Simone", "f"), ("Marcel", "m"), ("Odette", "f"),
    ("Jordan", "m"), ("Cindy", "f"), ("Lucien", "m"), ("Germaine", "f"),
    ("Francis", "m"), ("Raymonde", "f"), ("Hervé", "m"), ("Solange", "f"),
    ("Brandon", "m"), ("Gisèle", "f"),
]

# (masculin, féminin)
EPITHETES = [
    ("le Fourbe", "la Fourbe"),
    ("le Sans-Pitié", "la Sans-Pitié"),
    ("l'Inoxydable", "l'Inoxydable"),
    ("le Terrible", "la Terrible"),
    ("le Chauve", "la Chauve"),
    ("le Magnifique", "la Magnifique"),
    ("l'Enrhumé", "l'Enrhumée"),
    ("le Bourrin", "la Bourrine"),
    ("le Sournois", "la Sournoise"),
    ("l'Increvable", "l'Increvable"),
    ("le Pas-Très-Futé", "la Pas-Très-Futée"),
    ("le Barbu", "la Barbue"),
    ("le Ronchon", "la Ronchonne"),
    ("le Conteneurisé", "la Conteneurisée"),
    ("l'Orchestré", "l'Orchestrée"),
    ("le Stateless", "la Stateless"),
    ("le Redondant", "la Redondante"),
    ("le Sans-Sommeil", "la Sans-Sommeil"),
    ("le Pacifique", "la Pacifique"),
    ("le Maudit", "la Maudite"),
    ("le Bienheureux", "la Bienheureuse"),
    ("l'Ambidextre", "l'Ambidextre"),
    ("le Lent", "la Lente"),
    ("le Foudroyant", "la Foudroyante"),
    ("le Distrait", "la Distraite"),
    ("le Vaillant", "la Vaillante"),
    ("l'Impitoyable", "l'Impitoyable"),
    ("le Velu", "la Velue"),
    ("le Répliqué", "la Répliquée"),
    ("l'Éphémère", "l'Éphémère"),
    ("le Hors-Quota", "la Hors-Quota"),
    ("le Déployé-un-Vendredi", "la Déployée-un-Vendredi"),
]


def _pick(pod_name: str):
    digest = hashlib.sha256(pod_name.encode()).digest()
    prenom, genre = PRENOMS[int.from_bytes(digest[0:4], "big") % len(PRENOMS)]
    masc, fem = EPITHETES[int.from_bytes(digest[4:8], "big") % len(EPITHETES)]
    return prenom, genre, (fem if genre == "f" else masc)


def display_name(pod_name: str) -> str:
    """Nom d'affichage déterministe : prénom + épithète accordée."""
    prenom, _, epithete = _pick(pod_name)
    return f"{prenom} {epithete}"


def accord(pod_name: str) -> str:
    """Suffixe d'accord pour les messages : "e" au féminin, "" au masculin."""
    return "e" if _pick(pod_name)[1] == "f" else ""


if __name__ == "__main__":
    for i in range(10):
        print(display_name(f"guerrier-7d9f8b-{i:05d}"))
